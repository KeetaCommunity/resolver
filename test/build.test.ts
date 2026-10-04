// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildNetwork, readNetworkInput } from '../src/build.ts';
import type { NetworkInput } from '../src/build.ts';
import { flatten } from '../src/entries.ts';
import type { Snapshot } from '../src/snapshot.ts';
import { encodeSnapshot } from '../src/snapshot.ts';
import type { Source } from '../src/sources.ts';
import { ToolError } from '../src/errors.ts';
import { canonicalJSON } from '../src/json.ts';
import type { JSONValue } from '../src/json.ts';

const sourceNames = ['murphy', 'changenow', 'pfp', 'alpaca', 'keetahub', 'velocity'];

function fixture(name: string): JSONValue {
	return(JSON.parse(fs.readFileSync(new URL(`./fixtures/sources/${name}.json`, import.meta.url), 'utf8')));
}

function makeSource(sourceID: string): Source {
	let selection: Source['selection'] = { kind: 'all' };
	if (sourceID === 'velocity') {
		selection = { kind: 'exclude', keys: ['fx/test-anchor', '$TEST'] };
	}
	return({ sourceID, url: `https://${sourceID}.example.invalid/metadata.json`, selection, rename: new Map() });
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
