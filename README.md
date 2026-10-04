# Keeta community resolver

Curated KeetaNet resolver metadata, built from listed sources and served as static JSON.

## Use

Served at `https://resolver.xescu.re/<network>/metadata.json`.
The community account has one external reference to that URL.
Community account: `keeta_aqlemsriu5wyoyzd4r5rgfn6qpndmua5tx2hx7k3vl6ustcal2ekcommunity`.
Add it as a secondary root.
The main resolver wins conflicts.

```ts
const communityRoot = KeetaNet.lib.Account.fromPublicKeyString('keeta_aqlemsriu5wyoyzd4r5rgfn6qpndmua5tx2hx7k3vl6ustcal2ekcommunity')
new Resolver({ root: [mainRoot, communityRoot], client })
```

## Layout

- `networks/<network>/sources.json`: the listed sources and their rules.
- `networks/<network>/snapshots/<sourceID>.json`: committed data that each source published.
- `dist/<network>/metadata.json`: build output. Not committed.
- `<network>` is a KeetaNet network alias (`main`, `test`).
- A network directory that does not exist is not built.
- The output is built only from committed snapshots.

### sources.json

- `version`: must be `1`.
- `sourceID`: `^[a-z0-9-]+$`. Unique. It is the snapshot file name.
- `url`: `keetanet://<account>/metadata` or `https://…`.
- `url` has no credentials and no fragment.
- A `keetanet` url has no port and no query.
- `include`: entry keys. Only these are taken from the source.
- `exclude`: entry keys. These are dropped from the source.
- `include` and `exclude` are mutually exclusive.
- `rename`: service key to a service key of the same type (`fx/a` to `fx/b`).
- Currencies cannot be renamed.

### Entry keys

- `<serviceType>/<serviceID>`, for example `fx/murphy`.
- `<currencyCode>`, for example `$MURF`.

### Rules

- A missing `include` target fails the build.
- A missing `rename` target fails the build.
- A missing `exclude` target is a warning.
- A conflict between sources fails the build.

## Commands

- `make check`: type check and tests.
- `make dist`: build `dist/<network>/metadata.json`.
- `make detect`: fetch all sources, write `pr-body-<network>.md`, write snapshots if the output changed.

## Add a source

1. Edit `networks/<network>/sources.json`.
2. Run `make detect`.
3. Commit.
4. Open a PR.

## Data

`snapshots/` holds data that the listed sources published.
A source change reaches clients only after a PR is merged.
A scheduled job opens one PR per network (`sources-update-<network>`) when a source changed.
Deploy runs on each push to `main`, then a smoke test checks the live file.

## Pointer

The account metadata is set by its admin, once per network:

```ts
Resolver.Metadata.formatMetadata({
	external: '2b828e33-2692-46e9-817e-9b93d63f28fd',
	url: 'https://resolver.xescu.re/<network>/metadata.json'
})
```

The owner key is cold. It is never used in CI.

## License

MPL-2.0
