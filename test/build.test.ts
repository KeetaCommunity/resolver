// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as KeetaNet from '@keetanetwork/keetanet-client';
import { extractSignedFields } from '@keetanetwork/anchor/lib/anchor-metadata-server.js';
import { SignData, objectToSignable } from '@keetanetwork/anchor/lib/utils/signing.js';
import { buildNetwork, readNetworkInput } from '../src/build.ts';
import type { NetworkInput } from '../src/build.ts';
import { flatten } from '../src/entries.ts';
import type { Snapshot } from '../src/snapshot.ts';
import { encodeSnapshot } from '../src/snapshot.ts';
import type { Source } from '../src/sources.ts';
import { ToolError } from '../src/errors.ts';
import { canonicalJSON } from '../src/json.ts';
import type { JSONValue } from '../src/json.ts';

const kta = 'keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg';
const pepe = 'keeta_aoretuxg77xu34nwxkqw35wrboyafl6j2cnn44ssf66w5xcbyvjn6h2j7pgk2';
const doge = 'keeta_amnm6tkd74unfbwxqlnbqt2gfe6uq6ymiwqums7jned2fbsz22xhq2qhdx4sy';

const sourceNames = ['murphy', 'changenow', 'pfp', 'alpaca', 'keetahub', 'velocity'];

function fixture(name: string): JSONValue {
	return(JSON.parse(fs.readFileSync(new URL(`./fixtures/sources/${name}.json`, import.meta.url), 'utf8')));
}

function makeSource(sourceID: string): Source {
	let selection: Source['selection'] = { kind: 'all' };
	const add = new Map<string, string>();
	if (sourceID === 'velocity') {
		selection = { kind: 'exclude', keys: ['fx/test-anchor', '$TEST'] };
		// Mirrors networks/main/sources.json: its fx entries trade against KTA.
		add.set('$KTA', 'keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg');
	}
	return({ sourceID, url: `https://${sourceID}.example.invalid/metadata.json`, selection, rename: new Map(), add });
}

function makeSnapshot(source: Source): Snapshot {
	return({ sourceID: source.sourceID, url: source.url, entries: flatten(fixture(source.sourceID)).entries });
}

function makeInput(names: string[]): NetworkInput {
	const sources = names.map(makeSource);
	const snapshots = new Map<string, Snapshot>();
	for (const source of sources) {
		snapshots.set(source.sourceID, makeSnapshot(source));
	}
	return({ sources, snapshots });
}

function hasCode(code: string, message: string): (error: unknown) => boolean {
	return((error) => {
		return(ToolError.isInstance(error) && error.code === code && error.message === message);
	});
}

test('builds all six fixtures without the excluded velocity entries', async () => {
	const result = await buildNetwork(makeInput(sourceNames));
	assert.equal(result.document.services['fx']?.['test-anchor'], undefined);
	assert.equal(result.document.currencyMap['$TEST'], undefined);
	assert.notEqual(result.document.services['fx']?.['launchpad-anchor'], undefined);
	assert.equal(result.output, canonicalJSON(result.document));
});

test('output is byte-identical when sources and snapshots are shuffled', async () => {
	const first = await buildNetwork(makeInput(sourceNames));
	const input = makeInput([...sourceNames].reverse());
	const shuffled: NetworkInput = {
		sources: [...input.sources].sort(() => {
			return(1);
		}),
		snapshots: new Map([...input.snapshots].reverse())
	};
	const second = await buildNetwork(shuffled);
	assert.equal(second.output, first.output);
});

test('no sources and no snapshots give the empty document', async () => {
	const result = await buildNetwork({ sources: [], snapshots: new Map() });
	assert.deepEqual(result.document, { version: 1, currencyMap: {}, services: {} });
});

test('a source without a snapshot throws SNAPSHOT_MISSING', async () => {
	const input = makeInput(['murphy', 'pfp']);
	input.snapshots.delete('pfp');
	await assert.rejects(buildNetwork(input), hasCode('SNAPSHOT_MISSING', 'pfp'));
});

test('a snapshot without a source throws SNAPSHOT_ORPHAN', async () => {
	const input = makeInput(['murphy', 'pfp']);
	input.sources = input.sources.filter((source) => {
		return(source.sourceID !== 'pfp');
	});
	await assert.rejects(buildNetwork(input), hasCode('SNAPSHOT_ORPHAN', 'pfp'));
});

test('a snapshot url that differs from its source throws SNAPSHOT_MISMATCH', async () => {
	const input = makeInput(['murphy']);
	const snapshot = input.snapshots.get('murphy');
	if (snapshot === undefined) {
		throw(new Error('snapshot missing'));
	}
	snapshot.url = 'https://other.example.invalid/metadata.json';
	await assert.rejects(buildNetwork(input), hasCode('SNAPSHOT_MISMATCH', 'murphy'));
});

test('a snapshot sourceID that differs from its source throws SNAPSHOT_MISMATCH', async () => {
	const input = makeInput(['murphy']);
	const snapshot = input.snapshots.get('murphy');
	if (snapshot === undefined) {
		throw(new Error('snapshot missing'));
	}
	snapshot.sourceID = 'other';
	await assert.rejects(buildNetwork(input), hasCode('SNAPSHOT_MISMATCH', 'murphy'));
});

test('readNetworkInput reads sources.json and snapshots keyed by base name', () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'resolver-build-'));
	try {
		const source = makeSource('murphy');
		fs.writeFileSync(path.join(directory, 'sources.json'), JSON.stringify({ version: 1, sources: [{ sourceID: source.sourceID, url: source.url }] }));
		fs.mkdirSync(path.join(directory, 'snapshots'));
		fs.writeFileSync(path.join(directory, 'snapshots', '.gitkeep'), '');
		fs.writeFileSync(path.join(directory, 'snapshots', 'murphy.json'), encodeSnapshot(makeSnapshot(source)));

		const input = readNetworkInput(directory);
		assert.equal(input.sources.length, 1);
		assert.deepEqual([...input.snapshots.keys()], ['murphy']);
	} finally {
		fs.rmSync(directory, { recursive: true });
	}
});

test('readNetworkInput treats a directory with only .gitkeep as no snapshots', () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'resolver-build-'));
	try {
		fs.writeFileSync(path.join(directory, 'sources.json'), '{ "version": 1, "sources": [] }');
		fs.mkdirSync(path.join(directory, 'snapshots'));
		fs.writeFileSync(path.join(directory, 'snapshots', '.gitkeep'), '');
		const input = readNetworkInput(directory);
		assert.equal(input.snapshots.size, 0);
	} finally {
		fs.rmSync(directory, { recursive: true });
	}
});

function fromOf(entry: JSONValue | undefined): JSONValue | undefined {
	if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
		return(undefined);
	}
	return(entry['from']);
}

function customSource(sourceID: string, selection: Source['selection']): Source {
	return({ sourceID, url: `https://${sourceID}.example.invalid/metadata.json`, selection, rename: new Map(), add: new Map() });
}

function customInput(parts: { source: Source; document: JSONValue }[]): NetworkInput {
	const snapshots = new Map<string, Snapshot>();
	for (const { source, document } of parts) {
		snapshots.set(source.sourceID, { sourceID: source.sourceID, url: source.url, entries: flatten(document).entries });
	}
	return({ sources: parts.map((part) => {
		return(part.source);
	}), snapshots });
}

function fxDocument(currencyMap: { [code: string]: string }): JSONValue {
	return({
		version: 1,
		currencyMap,
		services: { fx: { a: {
			operations: { getEstimate: 'https://a.example/e', getQuote: 'https://a.example/q', createExchange: 'https://a.example/c', getExchangeStatus: 'https://a.example/s/{id}' },
			from: [{ currencyCodes: [kta], to: [pepe, doge] }]
		} } }
	});
}

test('velocity without add fails with FX_TOKEN_UNLISTED', async () => {
	const input = makeInput(sourceNames);
	const velocity = input.sources.find((source) => {
		return(source.sourceID === 'velocity');
	});
	if (velocity === undefined) {
		throw(new Error('velocity missing'));
	}
	velocity.add = new Map();
	await assert.rejects(buildNetwork(input), (error) => {
		return(ToolError.isInstance(error) && error.code === 'FX_TOKEN_UNLISTED' && error.message.startsWith('velocity fx/') && error.message.endsWith(`token not in currencyMap: ${kta}`));
	});
});

test('velocity with add builds and publishes the added currency', async () => {
	const result = await buildNetwork(makeInput(sourceNames));
	assert.equal(result.document.currencyMap['$KTA'], kta);
});

test('an add for a code the snapshot has throws ADD_COLLISION', async () => {
	const input = makeInput(sourceNames);
	const velocity = input.sources.find((source) => {
		return(source.sourceID === 'velocity');
	});
	if (velocity === undefined) {
		throw(new Error('velocity missing'));
	}
	velocity.add = new Map([['$L', kta]]);
	await assert.rejects(buildNetwork(input), hasCode('ADD_COLLISION', 'velocity add $L: already in source'));
});

test('a token whose only currency is excluded is pruned from the fx rules', async () => {
	const document = fxDocument({ $KTA: kta, $PEPE: pepe, $DOGE: doge });
	const source = customSource('a', { kind: 'exclude', keys: ['$DOGE'] });
	const result = await buildNetwork(customInput([{ source, document }]));
	assert.deepEqual(result.document.services['fx']?.['a'], {
		operations: { getEstimate: 'https://a.example/e', getQuote: 'https://a.example/q', createExchange: 'https://a.example/c', getExchangeStatus: 'https://a.example/s/{id}' },
		from: [{ currencyCodes: [kta], to: [pepe] }]
	});
	assert.deepEqual(result.warnings, [`fx/a: removed token ${doge}`]);
});

test('a token that another source still lists is not pruned', async () => {
	const first = customSource('a', { kind: 'exclude', keys: ['$DOGE'] });
	const second = customSource('b', { kind: 'include', keys: ['$DOGE'] });
	const result = await buildNetwork(customInput([
		{ source: first, document: fxDocument({ $KTA: kta, $PEPE: pepe, $DOGE: doge }) },
		{ source: second, document: { version: 1, currencyMap: { $DOGE: doge }, services: {} } }
	]));
	assert.deepEqual(fromOf(result.document.services['fx']?.['a']), [{ currencyCodes: [kta], to: [pepe, doge] }]);
	assert.deepEqual(result.warnings, []);
});

test('an fx entry left without pairs leaves the merged entries and provenance', async () => {
	const document = fxDocument({ $KTA: kta, $PEPE: pepe, $DOGE: doge });
	const source = customSource('a', { kind: 'exclude', keys: ['$DOGE', '$PEPE'] });
	const result = await buildNetwork(customInput([{ source, document }]));
	assert.equal(result.merged.entries.has('fx/a'), false);
	assert.equal(result.merged.provenance.has('fx/a'), false);
	assert.equal(result.merged.provenance.has('$KTA'), true);
	assert.equal(result.document.services['fx'], undefined);
	assert.deepEqual(result.warnings, [`fx/a: removed token ${pepe}`, `fx/a: removed token ${doge}`, 'fx/a: removed (no pairs left)']);
});

function tamperedChangenow(): Snapshot {
	const source = makeSource('changenow');
	const snapshot = makeSnapshot(source);
	const entry = snapshot.entries.get('assetMovement/changenow-staging');
	if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
		throw(new Error('changenow-staging entry missing from fixture'));
	}
	snapshot.entries.set('assetMovement/changenow-staging', { ...entry, operations: { tampered: 'https://evil.example/x' } });
	return(snapshot);
}

test('a tampered signed entry of a source fails with that source named', async () => {
	const input = makeInput(['changenow']);
	input.snapshots.set('changenow', tamperedChangenow());
	await assert.rejects(buildNetwork(input), hasCode('VALIDATION', 'changenow bad signature: assetMovement/changenow-staging'));
});

test('a tampered signed entry that is excluded does not fail the build', async () => {
	const input = makeInput(['changenow']);
	input.snapshots.set('changenow', tamperedChangenow());
	const [source] = input.sources;
	if (source === undefined) {
		throw(new Error('source missing'));
	}
	source.selection = { kind: 'exclude', keys: ['assetMovement/changenow-staging'] };
	const result = await buildNetwork(input);
	assert.equal(result.document.services['assetMovement'], undefined);
});

const fxOperations = { getEstimate: 'https://a.example/e', getQuote: 'https://a.example/q', createExchange: 'https://a.example/c', getExchangeStatus: 'https://a.example/s/{id}' };

// Signs the way an anchor's metadata server does.
async function signedFXDocument(): Promise<JSONValue> {
	const signer = KeetaNet.lib.Account.fromSeed('0'.repeat(64), 0);
	const account = signer.publicKeyString.get();
	const signed = await SignData(signer, objectToSignable(extractSignedFields(account, { operations: fxOperations })));
	return({
		version: 1,
		currencyMap: { $KTA: kta, $PEPE: pepe, $DOGE: doge },
		services: { fx: { a: { operations: fxOperations, from: [{ currencyCodes: [kta], to: [pepe, doge] }], account, signed } } }
	});
}

test('a signed fx entry left whole keeps its signature and validates', async () => {
	const document = await signedFXDocument();
	const source = customSource('a', { kind: 'all' });
	const result = await buildNetwork(customInput([{ source, document }]));
	const entry = result.document.services['fx']?.['a'];
	assert.equal(canonicalJSON(entry ?? null), canonicalJSON(flatten(document).entries.get('fx/a') ?? null));
	assert.deepEqual(result.warnings, []);
});

test('a signed fx entry with a pruned token loses its signature and validates', async () => {
	const document = await signedFXDocument();
	const source = customSource('a', { kind: 'exclude', keys: ['$DOGE'] });
	// buildNetwork validates the document, so it resolving is the validation passing.
	const result = await buildNetwork(customInput([{ source, document }]));
	assert.deepEqual(result.document.services['fx']?.['a'], {
		operations: fxOperations,
		from: [{ currencyCodes: [kta], to: [pepe] }]
	});
	assert.deepEqual(result.warnings, [`fx/a: removed token ${doge}`, 'fx/a: signature removed (entry modified)']);
});

test('a signed assetMovement entry is published byte for byte', async () => {
	const result = await buildNetwork(makeInput(sourceNames));
	const upstream = flatten(fixture('changenow')).entries.get('assetMovement/changenow-staging');
	const published = result.document.services['assetMovement']?.['changenow-staging'];
	if (upstream === undefined || published === undefined) {
		throw(new Error('changenow-staging entry missing'));
	}
	assert.ok(typeof upstream === 'object' && upstream !== null && 'signed' in upstream);
	assert.equal(canonicalJSON(published), canonicalJSON(upstream));
});
