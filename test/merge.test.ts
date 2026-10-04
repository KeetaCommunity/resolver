// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mergeContributions } from '../src/merge.ts';
import type { Contribution } from '../src/merge.ts';
import { unflatten } from '../src/entries.ts';
import { canonicalJSON } from '../src/json.ts';
import { ToolError } from '../src/errors.ts';

function contribution(sourceID: string, pairs: [string, string | { [key: string]: number }][]): Contribution {
	return({ sourceID, entries: new Map(pairs) });
}

test('equal duplicates give one entry with both sources recorded', () => {
	const merged = mergeContributions([
		contribution('b', [['USD', { x: 1 }], ['fx/b', { y: 2 }]]),
		contribution('a', [['USD', { x: 1 }]])
	]);
	assert.equal(merged.entries.size, 2);
	assert.deepEqual(merged.provenance.get('USD'), ['a', 'b']);
	assert.deepEqual(merged.provenance.get('fx/b'), ['b']);
});

test('different duplicates throw CONFLICT naming both sources', () => {
	assert.throws(() => {
		mergeContributions([
			contribution('b', [['USD', { x: 2 }]]),
			contribution('a', [['USD', { x: 1 }]])
		]);
	}, (error) => {
		return(ToolError.isInstance(error) && error.code === 'CONFLICT' && error.message === 'conflict: USD a={…} b={…}');
	});
});

test('conflict message cuts long string values', () => {
	assert.throws(() => {
		mergeContributions([
			contribution('a', [['USD', 'abcdefghijklmnop']]),
			contribution('b', [['USD', 'short']])
		]);
	}, (error) => {
		return(ToolError.isInstance(error) && error.message === 'conflict: USD a=abcdefghijkl… b=short');
	});
});

test('fields of two entries are not merged', () => {
	assert.throws(() => {
		mergeContributions([
			contribution('a', [['USD', { x: 1 }]]),
			contribution('b', [['USD', { y: 1 }]])
		]);
	}, (error) => {
		return(ToolError.isInstance(error) && error.code === 'CONFLICT');
	});
});

test('source order does not change the output', () => {
	const x = contribution('x', [['USD', { v: 1 }], ['fx/x', { v: 2 }]]);
	const y = contribution('y', [['USD', { v: 1 }], ['EUR', { v: 3 }]]);
	const forward = mergeContributions([x, y]);
	const backward = mergeContributions([y, x]);
	assert.equal(canonicalJSON(unflatten(forward.entries)), canonicalJSON(unflatten(backward.entries)));
	assert.deepEqual(forward.provenance, backward.provenance);
});
