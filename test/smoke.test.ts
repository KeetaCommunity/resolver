// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import * as assert from 'node:assert/strict';
import { canonicalJSON } from '../src/json.ts';
import type { JSONValue } from '../src/json.ts';
import { checkHeaders, compareRoot, retryUntilClean } from '../src/smoke.ts';
import type { RootReader } from '../src/smoke.ts';

const tokenAccount = 'keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg';

// The stub implements only what compareRoot uses.
function stubResolver(root: JSONValue, tokenCount: number): RootReader {
	const tokens: { token: string; currency: string }[] = [];
	for (let index = 0; index < tokenCount; index++) {
		tokens.push({ token: tokenAccount, currency: `C${index}` });
	}
	return({ getRootMetadata: async () => root, listTokens: async () => tokens, stats: { reads: 0 } } as unknown as RootReader);
}

const document: JSONValue = { version: 1, currencyMap: { USD: tokenAccount, EUR: tokenAccount }, services: {} };

test('checkHeaders accepts the CORS header and a JSON content type', () => {
	const headers = new Headers({ 'access-control-allow-origin': '*', 'content-type': 'application/json; charset=utf-8' });
	assert.deepEqual(checkHeaders(headers), []);
});
test('checkHeaders reports a missing access-control-allow-origin', () => {
	const headers = new Headers({ 'content-type': 'application/json' });
	assert.deepEqual(checkHeaders(headers), ['missing header: access-control-allow-origin: *']);
});
test('checkHeaders reports an access-control-allow-origin that is not *', () => {
	const headers = new Headers({ 'access-control-allow-origin': 'https://example.org', 'content-type': 'application/json' });
	assert.deepEqual(checkHeaders(headers), ['missing header: access-control-allow-origin: *']);
});
test('checkHeaders reports a wrong content-type', () => {
	const headers = new Headers({ 'access-control-allow-origin': '*', 'content-type': 'text/html' });
	assert.deepEqual(checkHeaders(headers), ['wrong content-type: text/html']);
});
test('checkHeaders reports a missing content-type', () => {
	const headers = new Headers({ 'access-control-allow-origin': '*' });
	assert.deepEqual(checkHeaders(headers), ['wrong content-type: (none)']);
});
test('compareRoot passes when root and token count match', async () => {
	assert.deepEqual(await compareRoot(stubResolver(document, 2), canonicalJSON(document)), []);
});
test('compareRoot reports a root that differs from dist', async () => {
	const other: JSONValue = { version: 1, currencyMap: { USD: tokenAccount, EUR: tokenAccount }, services: { kyc: {} } };
	assert.deepEqual(await compareRoot(stubResolver(document, 2), canonicalJSON(other)), ['root metadata differs from dist']);
});
test('compareRoot reports a token count that differs from the currency entries', async () => {
	assert.deepEqual(await compareRoot(stubResolver(document, 1), canonicalJSON(document)), ['listTokens count 1 != currency entries 2']);
});
test('compareRoot reports an unresolvable root instead of throwing', async () => {
	const resolver = { getRootMetadata: async () => { throw(new Error('no metadata')); }, listTokens: async () => [], stats: { reads: 0 } } as unknown as RootReader;
	assert.deepEqual(await compareRoot(resolver, canonicalJSON(document)), ['root metadata unresolved: no metadata']);
});
// Lets the loop run up to its next sleep, then moves the mocked clock on by one step.
async function drive(t: TestContext, pending: Promise<string[]>, stepMs: number): Promise<string[]> {
	let settled = false;
	pending.then(() => {
		settled = true;
	}, () => {
		settled = true;
	});
	for (let step = 0; step < 100 && !settled; step++) {
		await new Promise((resolve) => {
			setImmediate(resolve);
		});
		if (!settled) {
			t.mock.timers.tick(stepMs);
		}
	}
	return(await pending);
}

test('retryUntilClean stops at the first clean attempt', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
	const times: number[] = [];
	const pending = retryUntilClean({
		attempt: async (number) => {
			times.push(Date.now());
			if (number < 3) {
				return(['not yet']);
			}
			return([]);
		},
		timeoutMs: 100,
		intervalMs: 10
	});
	assert.deepEqual(await drive(t, pending, 1), []);
	assert.deepEqual(times, [0, 10, 20]);
});
test('retryUntilClean returns the last problems at the deadline without overshooting it', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
	const times: number[] = [];
	const pending = retryUntilClean({
		attempt: async (number) => {
			times.push(Date.now());
			return([`attempt ${number}`]);
		},
		timeoutMs: 25,
		intervalMs: 10
	});
	assert.deepEqual(await drive(t, pending, 1), ['attempt 4']);
	assert.deepEqual(times, [0, 10, 20, 25]);
});
