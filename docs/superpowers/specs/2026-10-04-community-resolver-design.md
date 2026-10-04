# Community resolver — design

Date: 2026-10-04
Status: approved design, pending implementation plan

## 1. Purpose

Publish a Keeta **community resolver**: a curated set of service and currency
entries for legitimate anchors that are not (yet) in the main resolver.

- Resolver account: `keeta_aqlemsriu5wyoyzd4r5rgfn6qpndmua5tx2hx7k3vl6ustcal2ekcommunity`
- Hosted document: `https://resolver.xescu.re/metadata.json`
- Clients use it as a **secondary root**: `new Resolver({ root: [mainRoot, communityRoot], … })`.
  The SDK gives the first root priority, so the community resolver adds entries
  and never overrides the main resolver.

The repository is public. It must stay small, easy to audit, and easy to
review.

### Non-goals

- No server, database, or long-running process.
- No Keeta private key in CI.
- No live references to third-party data in the published document.
- No automatic acceptance of source changes in v1 (auto-merge for owned
  sources can come later).

## 2. Overview

```
sources.json ──► fetch ──► snapshots/<sourceID>.json   (raw, fully resolved, flattened; committed)
                                 │
                   rules from sources.json (include | exclude, rename)
                                 ▼
                   merge all sources ──► conflict? → fail
                                 ▼
                   unflatten ──► validate ──► dist/metadata.json ──► Cloudflare Pages
```

- **Pinning.** The published document is built only from committed
  snapshots. A source change reaches clients only after a person merges a PR.
- **Change detection.** A scheduled job fetches all sources and builds the
  output from the fresh data. It compares that output with the output built
  from the committed snapshots. If the two differ, the job opens or updates
  one rolling PR.
- **Hosting.** A static JSON file on Cloudflare Pages. The on-chain metadata
  of the resolver account is one external reference to that file. You set
  it once, by hand.

## 3. Entry model

The tool works on **entries**, not on nested JSON. A resolver document has
two kinds of entries:

| Kind | Location in a resolver document | Entry key (string form) |
|------|---------------------------------|-------------------------|
| Service | `services.<serviceType>.<serviceID>` | `<serviceType>/<serviceID>` — example `fx/murphy` |
| Currency | `currencyMap.<currencyCode>` | `<currencyCode>` — example `$MURF`, `USD` |

In code, an entry key is a discriminated union:

```typescript
type EntryKey =
	| { kind: 'service'; serviceType: ServiceType; serviceID: string }
	| { kind: 'currency'; currencyCode: string };
```

- `ServiceType` comes from the SDK: `keyof ServiceMetadata['services']`.
  The tool keeps a const list of the service types that it knows. An
  `AssertNever` proves at compile time that the list and the SDK type are
  the same set. When an SDK upgrade adds a service type, the build fails
  until the list is updated. The tool must never drop a new service type
  silently.
- The string form is frozen. It is part of the durable snapshot format and
  of `sources.json`. Encode and decode exist in one module (`src/entries.ts`).
  - A service key contains a `/`. A currency code never contains a `/`.
  - Decode splits a service key on the **first** `/`. Service types never
    contain `/`. A service ID can contain `/`.
- `flatten(document) → EntryMap` and `unflatten(EntryMap) → document` are the
  one encode / decode pair for the resolver document shape. For the entries,
  they are inverses of each other.
- Top-level keys other than `version`, `currencyMap`, and `services` are
  dropped. An unknown service type is also dropped. Each drop is reported as
  a warning in the change summary.

## 4. `sources.json`

```jsonc
{
  "version": 1,
  "sources": [
    { "sourceID": "murphy",   "url": "keetanet://keeta_athqkb6yw6h2e436xxaakuy4bctrqkqfctvy5xsp3ugvb3avv56zruxjcxauq/metadata" },
    { "sourceID": "velocity", "url": "keetanet://keeta_aab2lqgwz56u6dvfbqtsadcnfc2y4wdvl7rd2pkboxoray5mj3hmdzot2neu4wq/metadata",
      "exclude": ["fx/test-anchor", "$TEST"] },
    { "sourceID": "acme",     "url": "https://acme.example/meta.json",
      "include": ["fx/acme", "$ACME"],
      "rename": { "fx/acme": "fx/acme-community" } }
  ]
}
```

| Field | Rule |
|-------|------|
| `version` | Must be `1`. |
| `sourceID` | Required. Unique. Matches `^[a-z0-9-]+$`. You assign it, and it never changes. It is also the snapshot file name. |
| `url` | Required. `keetanet://<account>/metadata` or `https://…`. No other protocol is allowed. |
| `include` | Optional list of entry keys. Only these entries are taken from the source. |
| `exclude` | Optional list of entry keys. These entries are dropped from the source. |
| `rename` | Optional map from a service entry key to a new service entry key. The service type must stay the same (`fx/a` → `fx/b`). You cannot rename a currency entry. |

Rules:

- A source with both `include` and `exclude` is an error.
- When `include` or `rename` names an entry that is not in the snapshot, the
  build fails. You asked for that entry, and it is gone.
- When `exclude` names an entry that is not in the snapshot, the build gives
  a warning only.
- The file is not checked by TypeScript, so it is validated at runtime. One
  module (`src/sources.ts`) owns its decode.

**Why exclude and include behave differently.** With `exclude`, new entries
from a source show up in the review PR. Use it for sources that you mostly
trust. With `include`, new entries are ignored. Use it when you want one
item from a large source.

**Why currency renames are not allowed.** A currency code is what a wallet
shows to the user and what an FX lookup matches. A renamed code would change
what users think the token is. If two sources map one code to different
tokens, use `exclude` on one of them.

### Initial sources

murphy, changenow, pfp, alpaca, keetahub, and velocity — all read from
`keetanet://<account>/metadata`. The initial rules are
`exclude: ["fx/test-anchor", "$TEST"]` on velocity. Today these six sources
give about 130 KB of output and 332 currency codes. They have no conflicts.
One entry is signed (`assetMovement/changenow-staging`).

## 5. Fetch

`src/fetch.ts`: `fetchSource(url, context) → EntryMap`.

- It reads with the SDK. It creates one `Resolver` for each run, with the
  mainnet client injected. Then it calls
  `new Resolver.Metadata(url, …).value('object')` and
  `Resolver.Metadata.fullyResolveValuizable(…)`. This path supports
  `keetanet://` and HTTPS, follows nested external references to any depth,
  detects loops, and removes duplicate reads in a run. It is the same path
  that wallets use.
- The result has no external references. Example: the on-chain metadata of
  pfp is only two HTTPS references. The pfp snapshot holds the full data.
- If any reference fails (a broken URL, a loop, a non-object where an
  object must be), the **whole source** fails for that run. The tool never
  stores a snapshot that is only partly resolved.
- Each run makes a small, bounded number of reads (one document for each
  source plus its nested references). Nothing in the tool grows without a
  limit.

## 6. Snapshots

`snapshots/<sourceID>.json` is durable state, so its format has a version:

```jsonc
{
  "version": 1,
  "sourceID": "pfp",
  "url": "keetanet://keeta_aabdoyva…/metadata",
  "entries": {
    "$PFP": "keeta_amkizw23…",
    "fx/pfp_kta": { "operations": { … }, "from": [ … ] },
    "fx/pfp_nft": { … }
  }
}
```

- A snapshot holds the **raw** data of a source, before any rules. When you
  edit the rules in `sources.json`, the change is offline and you can
  reproduce it. The PR shows the new output, and the tool does not fetch
  again.
- The serialization is deterministic: keys are sorted at every depth, the
  indent is two spaces, and the file ends with a newline. The snapshot has
  no fetch timestamp, because a timestamp would change the file on every
  run.
- One module (`src/snapshot.ts`) owns encode and decode. Decode rejects an
  unknown `version` and rejects malformed entries.
- `sourceID` and `url` in the snapshot must match `sources.json`. If they do
  not match, the build fails. Then a stale snapshot cannot be built under a
  new URL. The fix is to fetch again.

## 7. Build

`bin/build.ts` (through `make`): snapshots and rules → `dist/metadata.json`.

1. **Apply the rules** (`src/rules.ts`) to the entries of each source.
2. **Merge** (`src/merge.ts`). Each entry stays whole.
   - When one key comes from more than one source with deep-equal values,
     the build accepts it and records all of those sources.
   - When the values differ, the build fails with a conflict error. The
     error names the key and both sources.
   - The order of sources in `sources.json` does not change the output.
   - The tool never merges the fields of two entries. A mixed entry would
     be one that no source published, and its signature would break.
3. **Unflatten** to `{ version: 1, currencyMap, services }`.
4. **Validate** (`src/validate.ts`):
   - `Resolver.Metadata.assertMetadata(document)` checks the SDK root
     schema.
   - For each service entry, it uses the same rule as the SDK lookup. An
     entry with neither `account` nor `signed` is unsigned and accepted. An
     entry with only one of the two is rejected. When both are present, the
     signature must verify with `verifyMetadataSignature` (from
     `@keetanetwork/anchor/lib/anchor-metadata-server`).
   - An invalid entry fails the build. The tool does not drop it silently.
     To fix it, you add the entry to `exclude`.
5. **Write** `dist/metadata.json`. The output is deterministic: the same
   inputs give the same bytes. The file is not committed.

## 8. Change detection

`.github/workflows/detect.yml` runs every hour, and you can also start it by
hand. It runs `bin/detect.ts`:

1. Fetch every source. When a fetch fails, the committed snapshot stays the
   same, and the failure goes into the summary.
2. Build the output from the committed snapshots and from the fresh
   snapshots. Compare the two outputs.
3. If the outputs are the same, stop. A change to entries that are not
   published does not open a PR.
4. If they differ, write the fresh snapshots and `pr-body.md`.
   `peter-evans/create-pull-request` then creates or force-updates the
   branch `sources-update` and its single PR.

`pr-body.md` (from `src/diff.ts`) is a fixed template with no prose. It has
one line per fact, grouped by source. A section that is empty is left out:

```
## velocity
+ fx/new-anchor
~ fx/velo-anchor
- $OLD
## pfp
! fetch failed: HTTP 503 https://pfponkeeta.xyz/anchors/pfp/v2/services.json
## build
! conflict: $FOO velocity=keeta_aa… alpaca=keeta_bb…
? exclude target missing: velocity fx/test-anchor
```

The markers are `+` (added), `-` (removed), `~` (changed), `!` (error), and
`?` (warning). When the fresh build fails, the PR still opens, so that you
see the error, but the required check fails. The README, the error messages,
and the logs use the same plain, factual style.

`.github/workflows/check.yml` runs on each PR. It runs `make check`
(type-check and tests) and `make dist`.

## 9. Deploy

`.github/workflows/deploy.yml` runs on each push to `main`:

1. `make check` and `make dist`.
2. `wrangler pages deploy dist`. This needs the Cloudflare API token and
   the account ID as repository secrets. These are the only secrets in the
   repository.
3. `bin/smoke.ts` runs against mainnet. It makes a real `Resolver` with the
   community account as the root, resolves all of the root metadata, and
   deep-compares it with `dist/metadata.json`. It also checks that
   `listTokens()` returns each currency entry. It also fetches
   `https://resolver.xescu.re/metadata.json` with an `Origin` header. The
   response must have `Access-Control-Allow-Origin: *`,
   `Content-Type: application/json`, and the cache header. Because of edge
   caching, it tries again for up to 3 minutes before it fails.

Cloudflare Pages reads a file named `_headers` at the root of the deployed
directory and applies the response headers in it for each path pattern. The
source is `static/_headers`. `make dist` copies it to `dist/_headers`:

```
/metadata.json
  Content-Type: application/json
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=60
```

A browser wallet fetches the file directly, so CORS is necessary. The SDK
sends only `Accept`, which is a CORS-safelisted header, so the browser does
not send a preflight. The file is public and needs no credentials, so `*` is
safe. The 60 s cache is the same as the default positive TTL of the SDK.

### One-time manual setup (not in CI)

- Make a Cloudflare Pages project and connect the custom domain
  `resolver.xescu.re` to it.
- Set the on-chain metadata of the resolver account to
  `Resolver.Metadata.formatMetadata({ external: '2b828e33-2692-46e9-817e-9b93d63f28fd', url: 'https://resolver.xescu.re/metadata.json' })`.
  The owner of the account key signs this. The README documents the
  snippet. The SDK supports a root that is only one external reference, and
  its test suite covers this case.

## 10. Failure handling

| Failure | Behavior |
|---------|----------|
| A source cannot be reached or resolved | Keep the previous snapshot. Report it in the PR body and the job summary. |
| Two sources conflict | The fresh build fails. The PR opens and its check fails. Fix it with `exclude`. |
| An entry fails schema or signature validation | The build fails, with the same flow as a conflict. |
| An `include` or `rename` target is missing | The build fails. |
| An `exclude` target is missing | Warning only. |
| An unknown top-level key or service type in a source | Dropped, with a warning. |
| An SDK upgrade adds a service type | The type-check fails until the known-types list is updated. |
| The deploy smoke test fails | The workflow fails. The previous Pages deployment stays available, and you can roll back in Cloudflare. |

## 11. Trust model

- **Content:** a person reviews everything that is published. No published
  value depends on a third party at read time.
- **Provenance:** signed entries keep `account` and `signed`. Their
  signatures never expire (`maxSkewMs: Infinity`), so they still verify
  after they are copied. Clients can filter with `accounts: […]` to trust
  only entries from particular signers.
- **Delivery:** HTTPS through Cloudflare, published by GitHub Actions. The
  on-chain pointer can only change through a block signed by the key of the
  resolver account. That key never goes into CI.
- **Precedence:** clients put the main resolver first, so the community
  resolver cannot override the main resolver.

## 12. Repository layout

```
community-resolver/
  sources.json
  snapshots/<sourceID>.json
  src/
    entries.ts     EntryKey, key encode/decode, flatten/unflatten, known service types
    sources.ts     sources.json decode + validation
    snapshot.ts    snapshot encode/decode (versioned)
    fetch.ts       SDK-based fetch + full resolution
    rules.ts       include / exclude / rename
    merge.ts       merge + conflict detection + provenance
    validate.ts    SDK schema + signature checks
    diff.ts        output diff → markdown summary
  bin/
    detect.ts      fetch → compare builds → snapshots + pr-body.md
    build.ts       snapshots + rules → dist/metadata.json
    smoke.ts       post-deploy check against mainnet
  test/
  static/_headers
  Makefile
  .github/workflows/{detect,check,deploy}.yml
  README.md
```

Estimated size: about 700 lines of product code, about 450 lines of tests,
and about 200 lines of build and CI configuration.

## 13. Stack and conventions

- **Runtime:** Node 24. TypeScript runs through Node's type stripping, so
  there is no compile step. `tsc --noEmit` runs in `make check`, because
  type stripping does not do a type-check, and the `AssertNever` proofs
  need one.
- **Dependencies:** `@keetanetwork/anchor` and
  `@keetanetwork/keetanet-client` with exact versions, and `typescript` as
  a development dependency. The lockfile is committed. Use the platform
  helpers (`assertNever` and `AssertNever` from `lib/utils/never`). Do not
  copy them into the repository.
- **Make** owns the build graph:
  - `dist/metadata.json` depends on `sources.json`, `snapshots/*.json`,
    `src/*.ts`, `bin/build.ts`, and the lockfile.
  - `make check` runs the type-check and the tests.
  - `fetch` and `detect` are phony targets. They have network side effects
    and are not build artifacts.
- **Code style:** follow `@keetanetwork/anchor`:
  - Tabs, `return(x)`, and `throw(new Error(…))`.
  - Full names, and abbreviations spelled as abbreviations (`sourceID`,
    `url`, `baseURL`).
  - No ternary expressions.
  - Comments tell why, not what.
- **Library and CLI split:** domain logic is in `src/`, as pure functions
  where possible. `bin/` only does I/O and maps typed errors to exit codes
  and messages.
- **Iterative build:** the tree compiles and runs at every step. A part
  that is not ready throws `new Error('not implemented')`. A stub never
  returns a fake result.

## 14. Guarantees and their tests

Each item is a guarantee that the design depends on. Each one has a test.

1. `unflatten(flatten(document))` gives back the entries of `document`. The
   round trip of an entry key string and its object form gives back the
   same value.
2. The snapshot and `sources.json` codecs round-trip. They reject an
   unknown `version` and malformed input.
3. The same inputs give a byte-identical `dist/metadata.json`. The order of
   sources does not change the output.
4. Equal duplicate entries merge. Different duplicate entries fail with a
   conflict error that names both sources.
5. A source with both `include` and `exclude` is an error. A missing
   `include` or `rename` target is an error. A missing `exclude` target is
   a warning. A rename that crosses service types is an error, and so is a
   currency rename.
6. A source fetch that fails (broken nested reference, loop) never makes a
   snapshot. In detect, the previous snapshot stays.
7. An entry with a valid signature passes. An entry that was changed after
   it was signed, or that has only one of `account` and `signed`, fails the
   build.
8. Detect opens a PR only when the built output changes.
9. The known service types are the same set as the service types of the
   SDK. This is a compile-time proof, not a test.

Tests use `node:test`. The test inputs are the six real source documents,
taken on 2026-10-04. Fetch tests inject the network dependencies through
the same fetch context that production uses: a KeetaNet client stub, and a
local plain-HTTP fixture that is reachable through the SDK's
`allowInsecureProtocols` option. Production never sets that option, and
`sources.json` validation still rejects `http:` URLs. No production code
has parameters that only tests use.

## 15. Decisions for the owner before publishing

- The license for this repository. `@keetanetwork/anchor` is distributed
  under the "Keeta Token Network Community License v1.0". Check that the
  license you choose is compatible with it.
- The GitHub repository name and visibility, and the Cloudflare Pages
  project name.
