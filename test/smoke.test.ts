// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { canonicalJSON } from '../src/json.ts';
import type { JSONValue } from '../src/json.ts';
import { checkHeaders, compareRoot, retryUntilClean } from '../src/smoke.ts';
import type { RootReader } from '../src/smoke.ts';

const tokenAccount = 'keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg';

// The stub implements only the two methods that compareRoot calls.
function stubResolver(root: JSONValue, tokenCount: number): RootReader {
	const tokens: { token: string; currency: string }[] = [];
	for (let index = 0; index < tokenCount; index++) {
		tokens.push({ token: tokenAccount, currency: `C${index}` });
	}
	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
	return({ getRootMetadata: async () => root, listTokens: async () => tokens } as unknown as RootReader);
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
	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
	const resolver = { getRootMetadata: async () => { throw(new Error('no metadata')); }, listTokens: async () => [] } as unknown as RootReader;
	assert.deepEqual(await compareRoot(resolver, canonicalJSON(document)), ['root metadata unresolved: no metadata']);
});
test('retryUntilClean stops at the first clean attempt', async () => {
	let clock = 0;
	const slept: number[] = [];
	const problems = await retryUntilClean({
		attempt: async (number) => {
			if (number < 3) {
				return(['not yet']);
			}
			return([]);
		},
		timeoutMs: 100,
		intervalMs: 10,
		sleep: async (milliseconds) => {
			slept.push(milliseconds);
			clock += milliseconds;
		},
		now: () => clock
	});
	assert.deepEqual(problems, []);
	assert.deepEqual(slept, [10, 10]);
});
test('retryUntilClean returns the last problems at the deadline without overshooting it', async () => {
	let clock = 0;
	const slept: number[] = [];
	const problems = await retryUntilClean({
		attempt: async (number) => {
			return([`attempt ${number}`]);
		},
		timeoutMs: 25,
		intervalMs: 10,
		sleep: async (milliseconds) => {
			slept.push(milliseconds);
			clock += milliseconds;
		},
		now: () => clock
	});
	assert.deepEqual(slept, [10, 10, 5]);
	assert.deepEqual(problems, ['attempt 4']);
});
