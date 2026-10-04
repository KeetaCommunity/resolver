// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import type { NetworkInput } from '../src/build.ts';
import { detect } from '../src/detect.ts';
import { flatten } from '../src/entries.ts';
import type { EntryMap } from '../src/entries.ts';
import { ToolError } from '../src/errors.ts';
import type { JSONValue } from '../src/json.ts';
import type { Snapshot } from '../src/snapshot.ts';
import type { Source } from '../src/sources.ts';

const sourceNames = ['murphy', 'changenow', 'pfp', 'alpaca', 'keetahub', 'velocity'];

type Fetched = { entries: EntryMap; warnings: string[] };

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

function makeInput(): NetworkInput {
	const sources = sourceNames.map(makeSource);
	const snapshots = new Map<string, Snapshot>();
	for (const source of sources) {
		snapshots.set(source.sourceID, { sourceID: source.sourceID, url: source.url, entries: flatten(fixture(source.sourceID)).entries });
	}
	return({ sources, snapshots });
}

function entryOf(input: NetworkInput, sourceID: string, key: string): JSONValue {
	const value = input.snapshots.get(sourceID)?.entries.get(key);
	if (value === undefined) {
		throw(new Error(`no entry: ${sourceID} ${key}`));
	}
	return(value);
}

function committed(input: NetworkInput, source: Source): Fetched {
	const snapshot = input.snapshots.get(source.sourceID);
	if (snapshot === undefined) {
		throw(new Error(`no snapshot: ${source.sourceID}`));
	}
	return({ entries: new Map(snapshot.entries), warnings: [] });
}

test('an unchanged fetch gives changed false', async () => {
	const input = makeInput();
	const result = await detect(input, async (source) => {
		return(committed(input, source));
	});
	assert.equal(result.changed, false);
	assert.equal(result.snapshots.length, sourceNames.length);
	assert.equal(result.body, '## build\nok\n');
});

test('a new entry under an excluded key gives changed false', async () => {
	const input = makeInput();
	const result = await detect(input, async (source) => {
		const fetched = committed(input, source);
		if (source.sourceID === 'velocity') {
			fetched.entries.set('$TEST', entryOf(input, 'velocity', '$PEPE'));
		}
		return(fetched);
	});
	assert.equal(result.changed, false);
	const velocity = result.snapshots.find((snapshot) => {
		return(snapshot.sourceID === 'velocity');
	});
	assert.deepEqual(velocity?.entries.get('$TEST'), entryOf(input, 'velocity', '$PEPE'));
});

test('a new published entry gives changed true and a + line', async () => {
	const input = makeInput();
	const key = '$NEWCOIN';
	const result = await detect(input, async (source) => {
		const fetched = committed(input, source);
		if (source.sourceID === 'velocity') {
			fetched.entries.set(key, entryOf(input, 'velocity', '$PEPE'));
		}
		return(fetched);
	});
	assert.equal(result.changed, true);
	assert.match(result.body, /^## velocity\n/);
	assert.ok(result.body.split('\n').includes(`+ ${key}`));
});

test('a failed fetch keeps the committed snapshot and is reported', async () => {
	const input = makeInput();
	const result = await detect(input, async (source) => {
		if (source.sourceID === 'pfp') {
			throw(new ToolError('FETCH', 'HTTP 503'));
		}
		return(committed(input, source));
	});
	assert.equal(result.changed, false);
	assert.equal(result.snapshots.some((snapshot) => {
		return(snapshot.sourceID === 'pfp');
	}), false);
	assert.equal(result.body, '## pfp\n! fetch failed: HTTP 503\n## build\nok\n');
});

test('an INVALID_DOCUMENT or plain error also counts as a fetch failure', async () => {
	const input = makeInput();
	const result = await detect(input, async (source) => {
		if (source.sourceID === 'pfp') {
			throw(new ToolError('INVALID_DOCUMENT', 'bad document'));
		}
		if (source.sourceID === 'alpaca') {
			throw(new Error('socket closed'));
		}
		return(committed(input, source));
	});
	assert.equal(result.changed, false);
	assert.equal(result.snapshots.length, sourceNames.length - 2);
	assert.equal(result.body, '## alpaca\n! fetch failed: socket closed\n## pfp\n! fetch failed: bad document\n## build\nok\n');
});

test('a missing committed snapshot with a working fetch gives changed true', async () => {
	const full = makeInput();
	const input = makeInput();
	input.snapshots.delete('pfp');
	const result = await detect(input, async (source) => {
		return(committed(full, source));
	});
	assert.equal(result.changed, true);
	assert.equal(result.snapshots.length, sourceNames.length);
	// The committed build fails, so there is nothing to compare entry by entry.
	assert.equal(result.body, '## build\nok\n');
});

test('a fresh build error is reported and counts as a change', async () => {
	const input = makeInput();
	const result = await detect(input, async (source) => {
		const fetched = committed(input, source);
		if (source.sourceID === 'alpaca') {
			fetched.entries.set('$VELO', entryOf(input, 'velocity', '$PEPE'));
		}
		return(fetched);
	});
	assert.equal(result.changed, true);
	assert.match(result.body, /^## build\n! CONFLICT: conflict: \$VELO /);
});

test('fetch warnings are prefixed with the sourceID and deduplicated', async () => {
	const input = makeInput();
	const result = await detect(input, async (source) => {
		const fetched = committed(input, source);
		if (source.sourceID === 'pfp') {
			fetched.warnings.push('odd entry', 'odd entry');
		}
		return(fetched);
	});
	assert.equal(result.body, '## build\nok\n? pfp: odd entry\n');
});
