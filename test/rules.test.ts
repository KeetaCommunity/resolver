// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { applyRules } from '../src/rules.ts';
import type { Source, Selection } from '../src/sources.ts';
import type { EntryMap } from '../src/entries.ts';
import { ToolError } from '../src/errors.ts';

function makeSource(selection: Selection, rename: [string, string][] = []): Source {
	return({ sourceID: 'src', url: 'https://example.invalid/r.json', selection, rename: new Map(rename), add: new Map() });
}

function makeEntries(): EntryMap {
	const entries: EntryMap = new Map();
	entries.set('USD', { a: 1 });
	entries.set('fx/one', { b: 2 });
	entries.set('fx/two', { c: 3 });
	return(entries);
}

function hasCode(code: string): (error: unknown) => boolean {
	return((error) => {
		return(ToolError.isInstance(error) && error.code === code);
	});
}

test('exclude drops the keys and warns for a missing key', () => {
	const result = applyRules(makeSource({ kind: 'exclude', keys: ['fx/one', 'fx/gone'] }), makeEntries());
	assert.deepEqual([...result.entries.keys()], ['USD', 'fx/two']);
	assert.deepEqual(result.warnings, ['exclude target missing: src fx/gone']);
});

test('include keeps only the listed keys', () => {
	const result = applyRules(makeSource({ kind: 'include', keys: ['fx/two', 'USD'] }), makeEntries());
	assert.deepEqual([...result.entries.keys()], ['USD', 'fx/two']);
	assert.deepEqual(result.warnings, []);
});

test('include of a missing key throws RULE_TARGET_MISSING', () => {
	assert.throws(() => {
		applyRules(makeSource({ kind: 'include', keys: ['fx/gone'] }), makeEntries());
	}, (error) => {
		return(hasCode('RULE_TARGET_MISSING')(error) && error instanceof Error && error.message === 'src include target missing: fx/gone');
	});
});

test('rename moves the value', () => {
	const result = applyRules(makeSource({ kind: 'all' }, [['fx/one', 'fx/uno']]), makeEntries());
	assert.deepEqual([...result.entries.keys()], ['USD', 'fx/uno', 'fx/two']);
	assert.deepEqual(result.entries.get('fx/uno'), { b: 2 });
});

test('rename applies after the selection', () => {
	const result = applyRules(makeSource({ kind: 'include', keys: ['fx/one'] }, [['fx/one', 'fx/uno']]), makeEntries());
	assert.deepEqual([...result.entries.keys()], ['fx/uno']);
});

test('rename of a missing key throws RULE_TARGET_MISSING', () => {
	assert.throws(() => {
		applyRules(makeSource({ kind: 'all' }, [['fx/gone', 'fx/uno']]), makeEntries());
	}, (error) => {
		return(hasCode('RULE_TARGET_MISSING')(error) && error instanceof Error && error.message === 'src rename target missing: fx/gone');
	});
});

test('rename of a key the selection removed throws RULE_TARGET_MISSING', () => {
	assert.throws(() => {
		applyRules(makeSource({ kind: 'exclude', keys: ['fx/one'] }, [['fx/one', 'fx/uno']]), makeEntries());
	}, hasCode('RULE_TARGET_MISSING'));
});

test('rename onto an existing key throws RENAME_COLLISION', () => {
	assert.throws(() => {
		applyRules(makeSource({ kind: 'all' }, [['fx/one', 'fx/two']]), makeEntries());
	}, hasCode('RENAME_COLLISION'));
});

test('two renames onto the same target throw RENAME_COLLISION', () => {
	assert.throws(() => {
		applyRules(makeSource({ kind: 'all' }, [['fx/one', 'fx/new'], ['fx/two', 'fx/new']]), makeEntries());
	}, hasCode('RENAME_COLLISION'));
});

test('all returns the input unchanged', () => {
	const entries = makeEntries();
	const result = applyRules(makeSource({ kind: 'all' }), entries);
	assert.deepEqual(result.entries, entries);
	assert.deepEqual(result.warnings, []);
});
