// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { flatten } from '../src/entries.ts';
import { ToolError } from '../src/errors.ts';
import { decodeSnapshot, encodeSnapshot } from '../src/snapshot.ts';
import type { Snapshot } from '../src/snapshot.ts';
import type { JSONValue } from '../src/json.ts';

function readFixture(name: string): ReturnType<typeof JSON.parse> {
	return(JSON.parse(fs.readFileSync(new URL(`./fixtures/sources/${name}.json`, import.meta.url), 'utf8')));
}

function isInvalidSnapshot(error: unknown): boolean {
	return(ToolError.isInstance(error) && error.code === 'INVALID_SNAPSHOT');
}

const base = { version: 1, sourceID: 'alpaca', url: 'https://example.com/resolver', entries: {} };

test('snapshot round-trips entries flattened from the alpaca fixture', () => {
	const { entries } = flatten(readFixture('alpaca'));
	assert.ok(entries.size > 0);
	const snapshot: Snapshot = { sourceID: 'alpaca', url: 'https://example.com/resolver', entries };
	const text = encodeSnapshot(snapshot);
	assert.ok(text.endsWith('\n'));
	assert.deepEqual(decodeSnapshot(text), snapshot);
});
test('encoding does not depend on insertion order', () => {
	const forward = new Map<string, JSONValue>([['USD', { a: 1, b: 2 }], ['fx/one', { c: 3 }], ['EUR', 'x']]);
	const reverse = new Map([...forward].reverse());
	const a = encodeSnapshot({ sourceID: 's', url: 'https://example.com', entries: forward });
	const b = encodeSnapshot({ sourceID: 's', url: 'https://example.com', entries: reverse });
	assert.equal(a, b);
});
test('encoding has the version, no timestamp and sorted keys', () => {
	const text = encodeSnapshot({ sourceID: 's', url: 'https://example.com', entries: new Map([['USD', 1]]) });
	assert.equal(text, '{\n  "entries": {\n    "USD": 1\n  },\n  "sourceID": "s",\n  "url": "https://example.com",\n  "version": 1\n}\n');
});
test('an entry key of __proto__ survives a round trip', () => {
	const snapshot: Snapshot = { sourceID: 's', url: 'https://example.com', entries: new Map([['__proto__', { x: 1 }]]) };
	const decoded = decodeSnapshot(encodeSnapshot(snapshot));
	assert.deepEqual(decoded, snapshot);
	// Decoding must not have set the shared prototype.
	assert.equal(({} as Record<string, unknown>)['x'], undefined);
});
test('decode rejects an unknown version', () => {
	assert.throws(() => decodeSnapshot(JSON.stringify({ ...base, version: 2 })), isInvalidSnapshot);
});
test('decode rejects an unknown entry key', () => {
	assert.throws(() => decodeSnapshot(JSON.stringify({ ...base, entries: { 'nope/x': {} } })), isInvalidSnapshot);
});
test('decode rejects a missing url', () => {
	const { url: _url, ...rest } = base;
	assert.throws(() => decodeSnapshot(JSON.stringify(rest)), isInvalidSnapshot);
});
test('decode rejects an extra top-level field', () => {
	assert.throws(() => decodeSnapshot(JSON.stringify({ ...base, extra: 1 })), isInvalidSnapshot);
});
test('decode rejects text that is not a snapshot object', () => {
	for (const bad of ['', 'not json', '[]', 'null', '1']) {
		assert.throws(() => decodeSnapshot(bad), isInvalidSnapshot);
	}
	assert.throws(() => decodeSnapshot(JSON.stringify({ ...base, sourceID: 1 })), isInvalidSnapshot);
	assert.throws(() => decodeSnapshot(JSON.stringify({ ...base, entries: [] })), isInvalidSnapshot);
});
