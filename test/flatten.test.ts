// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { flatten, unflatten } from '../src/entries.ts';
import type { EntryMap } from '../src/entries.ts';
import { sameJSON } from '../src/json.ts';
import type { JSONValue } from '../src/json.ts';
import { ToolError } from '../src/errors.ts';

const fixtureNames = ['murphy', 'changenow', 'pfp', 'alpaca', 'keetahub', 'velocity'];

type Fixture = { version: 1; currencyMap: { [code: string]: JSONValue }; services: { [type: string]: { [id: string]: JSONValue } } };

function readFixture(name: string): Fixture {
	return(JSON.parse(fs.readFileSync(new URL(`./fixtures/sources/${name}.json`, import.meta.url), 'utf8')));
}

test('flatten/unflatten round-trips every fixture', () => {
	for (const name of fixtureNames) {
		const document = readFixture(name);
		const { entries } = flatten(document);
		assert.ok(sameJSON(unflatten(entries), { version: 1, currencyMap: document.currencyMap, services: document.services }), name);
	}
});
test('flatten keys use the frozen string form', () => {
	const { entries } = flatten(readFixture('murphy'));
	assert.ok(entries.has('fx/murphy'));
	assert.equal(entries.get('$MURF'), readFixture('murphy').currencyMap.$MURF);
});
test('flatten drops unknown keys, types, and slash currency codes with warnings', () => {
	const { entries, warnings } = flatten({ version: 1, extra: 1, currencyMap: { 'A/B': 'x', USD: 'y' }, services: { fx: { 'a/b': {} }, future: { x: {} } } });
	assert.deepEqual([...entries.keys()].sort(), ['USD', 'fx/a/b']);
	assert.deepEqual(warnings.sort(), ['dropped currency code: A/B', 'dropped key: extra', 'dropped service type: future']);
});
test('flatten treats a missing currencyMap or services as empty', () => {
	const { entries, warnings } = flatten({ version: 1 });
	assert.equal(entries.size, 0);
	assert.deepEqual(warnings, []);
});
test('flatten rejects structurally invalid documents', () => {
	const invalid: JSONValue[] = [null, [], { version: 2, currencyMap: {}, services: {} }, { version: 1, currencyMap: [], services: {} }, { version: 1, currencyMap: {}, services: { fx: 'x' } }];
	for (const bad of invalid) {
		assert.throws(() => flatten(bad), (error) => ToolError.isInstance(error) && error.code === 'INVALID_DOCUMENT');
	}
});
test('unflatten of no entries has version, currencyMap, and services', () => {
	assert.deepEqual(unflatten(new Map()), { version: 1, currencyMap: {}, services: {} });
});
test('unflatten splits keys into currencies and services', () => {
	const entries: EntryMap = new Map<string, JSONValue>([['USD', 'y'], ['fx/team/a', { n: 1 }], ['kyc/k', 2]]);
	assert.deepEqual(unflatten(entries), { version: 1, currencyMap: { USD: 'y' }, services: { fx: { 'team/a': { n: 1 } }, kyc: { k: 2 } } });
});
