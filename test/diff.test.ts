// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { formatReport } from '../src/diff.ts';
import type { EntryMap } from '../src/entries.ts';
import type { Merged } from '../src/merge.ts';
import type { JSONValue } from '../src/json.ts';

function makeMerged(rows: [string, JSONValue, string[]][]): Merged {
	const entries: EntryMap = new Map();
	const provenance = new Map<string, string[]>();
	for (const [key, value, sources] of rows) {
		entries.set(key, value);
		provenance.set(key, sources);
	}
	return({ entries, provenance });
}

test('formats added, changed, removed, fetch failure and warning', () => {
	const before = makeMerged([
		['fx/velo-anchor', { n: 1 }, ['velocity']],
		['$OLD', 'old', ['velocity']],
		['fx/same', 'same', ['velocity']]
	]);
	const after = makeMerged([
		['fx/new', { n: 0 }, ['velocity']],
		['fx/velo-anchor', { n: 2 }, ['velocity']],
		['fx/same', 'same', ['velocity']]
	]);
	const report = formatReport({
		before,
		after,
		fetchFailures: new Map([['pfp', 'HTTP 503']]),
		warnings: ['exclude target missing: velocity fx/test-anchor'],
		buildError: undefined
	});
	assert.equal(report, [
		'## pfp',
		'! fetch failed: HTTP 503',
		'## velocity',
		'+ fx/new',
		'~ fx/velo-anchor',
		'- $OLD',
		'## build',
		'ok',
		'? exclude target missing: velocity fx/test-anchor',
		''
	].join('\n'));
});

test('lists a shared entry under each of its sources', () => {
	const before = makeMerged([]);
	const after = makeMerged([['fx/shared', 'v', ['alpaca', 'velocity']]]);
	const report = formatReport({ before, after, fetchFailures: new Map(), warnings: [], buildError: undefined });
	assert.equal(report, '## alpaca\n+ fx/shared\n## velocity\n+ fx/shared\n## build\nok\n');
});

test('an unchanged build gives only the build section', () => {
	const merged = makeMerged([['fx/a', 'v', ['velocity']]]);
	const report = formatReport({ before: merged, after: merged, fetchFailures: new Map(), warnings: [], buildError: undefined });
	assert.equal(report, '## build\nok\n');
});

test('a build error replaces ok and skips entry lines', () => {
	const before = makeMerged([['fx/a', 'v', ['velocity']]]);
	const report = formatReport({
		before,
		after: undefined,
		fetchFailures: new Map(),
		warnings: [],
		buildError: 'CONFLICT: conflict: fx/a'
	});
	assert.equal(report, '## build\n! CONFLICT: conflict: fx/a\n');
});

test('a changed value is reported for a source that stopped publishing it', () => {
	const before = makeMerged([['fx/a', 1, ['alpaca', 'velocity']]]);
	const after = makeMerged([['fx/a', 2, ['velocity']]]);
	const report = formatReport({ before, after, fetchFailures: new Map(), warnings: [], buildError: undefined });
	assert.equal(report, '## alpaca\n~ fx/a\n## velocity\n~ fx/a\n## build\nok\n');
});
