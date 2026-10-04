// SPDX-License-Identifier: MPL-2.0
import * as KeetaNet from '@keetanetwork/keetanet-client';
import Resolver from '@keetanetwork/anchor/lib/resolver.js';
import { flatten } from './entries.ts';
import type { EntryMap } from './entries.ts';
import { ToolError } from './errors.ts';
import type { JSONValue } from './json.ts';
import type { NetworkAlias } from './network.ts';

const communityAccount = 'keeta_aqlemsriu5wyoyzd4r5rgfn6qpndmua5tx2hx7k3vl6ustcal2ekcommunity';

/*
 * The SDK stops a reference loop only while two reads are in flight at the
 * same time. Our walk reads one at a time, so a loop would never end without
 * this bound on nested references.
 */
const maxReferenceDepth = 64;

// The SDK does not export its metadata config type.
type MetadataConfig = ConstructorParameters<typeof Resolver.Metadata>[1];

type FetchContext = {
	readonly resolver: Resolver;
	readonly client: MetadataConfig['client'];
	readonly cache: NonNullable<MetadataConfig['cache']>['instance'];
	readonly allowInsecureProtocols: boolean;
};

type FetchContextOptions = {
	network: NetworkAlias;
} | {
	// Test only: a stub in place of the KeetaNet client.
	client: unknown;
	allowInsecureProtocols: boolean;
};

function createFetchContext(options: FetchContextOptions): FetchContext {
	const root = KeetaNet.lib.Account.fromPublicKeyString(communityAccount);

	if ('network' in options) {
		const userClient = KeetaNet.UserClient.fromNetwork(options.network, null);
		const resolver = new Resolver({ root, client: userClient, trustedCAs: [] });
		return({ resolver, client: userClient.client, cache: new Map(), allowInsecureProtocols: false });
	}

	/*
	 * The stub implements only getAccountInfo, which is all the SDK calls. It
	 * cannot satisfy the client types, hence the casts through unknown.
	 */
	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
	const resolverClient = { client: options.client } as unknown as ConstructorParameters<typeof Resolver>[0]['client'];
	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
	const client = options.client as MetadataConfig['client'];
	const resolver = new Resolver({ root, client: resolverClient, trustedCAs: [] });
	return({ resolver, client, cache: new Map(), allowInsecureProtocols: options.allowInsecureProtocols });
}

/*
 * Resolves every nested reference. The SDK's own fullyResolveValuizable turns
 * a failed reference into null, which would store a partly resolved snapshot,
 * so any error propagates and a null anywhere fails the whole source.
 */
async function resolveStrict(value: unknown): Promise<JSONValue> {
	return(await walk(value, 0));
}

async function walk(value: unknown, depth: number): Promise<JSONValue> {
	if (Resolver.Metadata.isValuizable(value)) {
		if (depth >= maxReferenceDepth) {
			throw(new ToolError('FETCH', 'unresolved reference: too deeply nested or looping'));
		}
		return(await walk(await value('any'), depth + 1));
	}

	if (value === null || value === undefined) {
		throw(new ToolError('FETCH', 'unresolved reference'));
	}

	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return(value);
	}

	// One at a time, so the SDK's in-flight loop check sees a single chain.
	if (Array.isArray(value)) {
		const items: JSONValue[] = [];
		for (const item of value) {
			items.push(await walk(item, depth));
		}
		return(items);
	}

	if (typeof value === 'object') {
		const entries: [string, JSONValue][] = [];
		for (const [key, member] of Object.entries(value)) {
			entries.push([key, await walk(member, depth)]);
		}
		return(Object.fromEntries(entries));
	}

	throw(new ToolError('FETCH', `unsupported value: ${typeof value}`));
}

function describeError(error: unknown): string {
	if (error instanceof Error) {
		return(error.message);
	}
	return(String(error));
}

async function fetchSource(url: string, context: FetchContext): Promise<{ entries: EntryMap; warnings: string[] }> {
	let document: JSONValue;
	try {
		const metadata = new Resolver.Metadata(url, {
			client: context.client,
			resolver: context.resolver,
			trustedCAs: [],
			cache: { instance: context.cache },
			allowInsecureProtocols: context.allowInsecureProtocols
		});
		document = await resolveStrict(await metadata.value('object'));
	} catch (error) {
		if (ToolError.isInstance(error)) {
			throw(new ToolError('FETCH', `${url}: ${error.message}`));
		}
		throw(new ToolError('FETCH', `${url}: ${describeError(error)}`));
	}

	return(flatten(document));
}

export { createFetchContext, fetchSource, resolveStrict };
export type { FetchContext };
