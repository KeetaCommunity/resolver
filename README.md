# Community Resolver

Independent community project. Not affiliated with, endorsed by, or operated by Keeta or Globetrot Financial.

## Address

The Keeta Community Resolver is available at the following address:

```
keeta_aqlemsriu5wyoyzd4r5rgfn6qpndmua5tx2hx7k3vl6ustcal2ekcommunity
```

## Usage

Add the Community Resolver as a second root, after Keeta's root resolver:

```ts
new Resolver({ root: [mainRoot, communityRoot], client })
```

The root resolver takes precedence, so the Community Resolver can only add services, never override them.

The metadata is served at `https://resolver.xescu.re/main/metadata.json`.

## Motivation

Keeta Anchors are a framework for blockchain-native financial services that primarily live on Keeta Network. Registries, so called resolvers, keep a record of the available service providers.

These providers span all parts of a modern financial network and follow one standardized protocol. This includes:

- market makers (`FX Anchor`)
- onchain markets (`Orderbook Anchor`)
- identity (`KYC Anchor`)
- bridges, ramps (both `Asset Movement Anchors`)
- banking (`Banking Anchor`) and cards (`Cards Anchor`)
- addressing (`Username Anchor`)
- and even non-financial areas such as encrypted personal program data (`Storage Anchor`) and push notifications (`Notification Anchor`)

Keeta's root resolver, the *Globetrot Resolver*, provides access to the foundational services of Keeta, and recently in a [press release](https://keeta.com/blog/keeta-opens-its-ecosystem), they had further announced expansion of this resolver. It is now open to the public; and other services can register to be discovered by any Keeta powered application around the world. For details on the application procedure, pricing, and compliance requirements, please refer to Keeta's press statement.

As Keeta grows, dozens and dozens of services will want to register. Some may be in early stages and might not be ready for universal availability. Others may not yet pass the rigorous compliance requirements set out by Globetrot Financial. The Community Resolver offers fast-track availability for new Anchors. It aims to make the Keeta ecosystem more dynamic and provide developers, both on the client and the service side, with a place to ship, test and gather feedback before a Globetrot listing.

## Principles

Who can be listed in the Keeta Community Resolver:

- any project that adds value to the ecosystem
- does not confuse or attempt to defraud
- procedure is adjusted based on anchor type and its trust model, i.e. asset movement anchors are scrutinized more than FX anchors
- no fee is charged, as costs are low, up for reevaluation when this changes.

The services passing the requirements and initially listed in the Community Resolver are the following:

- Alpaca https://alpacadex.com/
- ChangeNOW (operated by `@xescure`) https://changenow.io/
- KeetaHub https://keetahub.com/
- Murphy https://murf.fi
- Peregrine Falcon Punk https://pfponkeeta.xyz/
- Velocity https://velocityonkeeta.com/

## Listing

To get a service listed, open an [issue](https://github.com/KeetaCommunity/resolver/issues).

## Governance

The initial version of the Community Resolver is governed by community member `@xescure`.

Keys and operational infrastructure are handled by `@xescure`. The resolver is GitHub-native and any addition or modification will take place via transparent pull request.

Operational costs are sponsored by the [Murphy Foundation](https://murf.fi/).

## Legal

Licensed under [MPL-2.0](LICENSE). Provided as is, without warranty or liability (see sections 6 and 7 of the license).
