// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { unflatten } from '../src/entries.ts';
import type { EntryMap } from '../src/entries.ts';
import { ToolError } from '../src/errors.ts';
import { canonicalJSON } from '../src/json.ts';
import type { JSONValue } from '../src/json.ts';
import { checkSourceTokens, isCanonicalCurrencyCode, isTokenAddress, listedTokens, pruneFX } from '../src/tokens.ts';

const kta = 'keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg';
const pepe = 'keeta_aoretuxg77xu34nwxkqw35wrboyafl6j2cnn44ssf66w5xcbyvjn6h2j7pgk2';
const doge = 'keeta_amnm6tkd74unfbwxqlnbqt2gfe6uq6ymiwqums7jned2fbsz22xhq2qhdx4sy';
const murphyAccount = 'keeta_athqkb6yw6h2e436xxaakuy4bctrqkqfctvy5xsp3ugvb3avv56zruxjcxauq';

function fxEntry(from: JSONValue, extra: { [key: string]: JSONValue } = {}): JSONValue {
	return({ operations: { getEstimate: 'https://a.example/e' }, from, ...extra });
}

function hasCode(code: string, message: string): (error: unknown) => boolean {
	return((error) => {
		return(ToolError.isInstance(error) && error.code === code && error.message === message);
	});
}

test('isTokenAddress accepts tokens only', () => {
	assert.equal(isTokenAddress(kta), true);
	// The same key under the other prefix the client accepts.
	assert.equal(isTokenAddress(`tyblocks_${kta.slice('keeta_'.length)}`), false);
	assert.equal(isTokenAddress(murphyAccount), false);
	assert.equal(isTokenAddress('$KTA'), false);
	assert.equal(isTokenAddress(''), false);
	assert.equal(isTokenAddress(5), false);
	assert.equal(isTokenAddress(undefined), false);
});

test('isCanonicalCurrencyCode accepts what the SDK looks up', () => {
	for (const code of ['USD', 'EUR', '$KTA', '$MURF', '$X2']) {
		assert.equal(isCanonicalCurrencyCode(code), true, code);
	}
	for (const code of ['USDC', 'kta', 'usd', '__proto__', '$X\n## build', '$X Y', '$X\t', '']) {
		assert.equal(isCanonicalCurrencyCode(code), false, JSON.stringify(code));
	}
});

test('a non-canonical currency code gives INVALID_TOKEN', () => {
	for (const code of ['USDC', 'kta', '__proto__', '$X\n## build']) {
		const entries: EntryMap = new Map([[code, kta]]);
		assert.throws(() => checkSourceTokens('acme', entries, listedTokens(entries)), hasCode('INVALID_TOKEN', `acme ${code}: not a canonical currency code`), JSON.stringify(code));
	}
});

test('a currency value under another prefix gives INVALID_TOKEN', () => {
	const other = `tyblocks_${kta.slice('keeta_'.length)}`;
	const entries: EntryMap = new Map([['$KTA', other]]);
	assert.throws(() => checkSourceTokens('acme', entries, listedTokens(entries)), hasCode('INVALID_TOKEN', `acme $KTA: not a token address: ${other}`));
});

test('listedTokens returns the currency values', () => {
	const entries: EntryMap = new Map([
		['$KTA', kta],
		['$PEPE', pepe],
		['fx/a', fxEntry([{ currencyCodes: [doge], to: [kta] }])]
	]);
	assert.deepEqual([...listedTokens(entries)].sort(), [kta, pepe].sort());
});

test('a ticker in an fx rule gives INVALID_TOKEN', () => {
	const entries: EntryMap = new Map([
		['$KTA', kta],
		['fx/a', fxEntry([{ currencyCodes: ['$KTA'], to: [kta] }])]
	]);
	assert.throws(() => checkSourceTokens('acme', entries, listedTokens(entries)), hasCode('INVALID_TOKEN', 'acme fx/a: not a token address: $KTA'));

	const toTicker: EntryMap = new Map([
		['$KTA', kta],
		['fx/a', fxEntry([{ currencyCodes: [kta], to: ['$KTA'] }])]
	]);
	assert.throws(() => checkSourceTokens('acme', toTicker, listedTokens(toTicker)), hasCode('INVALID_TOKEN', 'acme fx/a: not a token address: $KTA'));
});

test('a non-token account as a currency value gives INVALID_TOKEN', () => {
	const entries: EntryMap = new Map([['$MURPHY', murphyAccount]]);
	assert.throws(() => checkSourceTokens('acme', entries, listedTokens(entries)), hasCode('INVALID_TOKEN', `acme $MURPHY: not a token address: ${murphyAccount}`));
});

test('a currency value that is not a string gives INVALID_TOKEN', () => {
	const entries: EntryMap = new Map<string, JSONValue>([['$X', 5]]);
	assert.throws(() => checkSourceTokens('acme', entries, new Set()), hasCode('INVALID_TOKEN', 'acme $X: not a token address: 5'));
});

test('a token that the source does not list gives FX_TOKEN_UNLISTED', () => {
	const entries: EntryMap = new Map([
		['$PEPE', pepe],
		['fx/a', fxEntry([{ currencyCodes: [kta], to: [pepe] }])]
	]);
	assert.throws(() => checkSourceTokens('acme', entries, listedTokens(entries)), hasCode('FX_TOKEN_UNLISTED', `acme fx/a: token not in currencyMap: ${kta}`));
});

test('the listed set is not the kept set', () => {
	const kept: EntryMap = new Map([
		['fx/a', fxEntry([{ currencyCodes: [kta], to: [pepe] }])]
	]);
	checkSourceTokens('acme', kept, new Set([kta, pepe]));
});

test('a malformed from gives INVALID_DOCUMENT', () => {
	const cases: JSONValue[] = [
		undefined as unknown as JSONValue,
		'x',
		{},
		[5],
		[{ currencyCodes: [kta] }],
		[{ currencyCodes: kta, to: [kta] }],
		[{ currencyCodes: [5], to: [kta] }]
	];
	for (const from of cases) {
		const entries: EntryMap = new Map([['fx/a', { operations: {}, from }]]);
		assert.throws(() => checkSourceTokens('acme', entries, new Set([kta])), hasCode('INVALID_DOCUMENT', 'acme fx/a: malformed from'), JSON.stringify(from));
	}
});

test('pruneFX removes a token and keeps the order', () => {
	const entries: EntryMap = new Map([
		['$KTA', kta],
		['$PEPE', pepe],
		['fx/a', fxEntry([{ currencyCodes: [kta], to: [doge, pepe] }])]
	]);
	const result = pruneFX(entries);
	assert.deepEqual(result.entries.get('fx/a'), fxEntry([{ currencyCodes: [kta], to: [pepe] }]));
	assert.deepEqual(result.warnings, [`fx/a: removed token ${doge}`]);
});

test('pruneFX removes a rule with an empty side', () => {
	const entries: EntryMap = new Map([
		['$KTA', kta],
		['$PEPE', pepe],
		['fx/a', fxEntry([
			{ currencyCodes: [kta], to: [doge] },
			{ currencyCodes: [kta], to: [pepe] }
		])]
	]);
	const result = pruneFX(entries);
	assert.deepEqual(result.entries.get('fx/a'), fxEntry([{ currencyCodes: [kta], to: [pepe] }]));
	assert.deepEqual(result.warnings, [`fx/a: removed token ${doge}`]);
});

test('pruneFX removes an entry without rules', () => {
	const entries: EntryMap = new Map([
		['$KTA', kta],
		['fx/a', fxEntry([{ currencyCodes: [kta], to: [doge] }])]
	]);
	const result = pruneFX(entries);
	assert.equal(result.entries.has('fx/a'), false);
	assert.equal(result.entries.get('$KTA'), kta);
	assert.deepEqual(result.warnings, [`fx/a: removed token ${doge}`, 'fx/a: removed (no pairs left)']);
});

test('pruneFX warns once per entry and token', () => {
	const entries: EntryMap = new Map([
		['$KTA', kta],
		['$PEPE', pepe],
		['fx/a', fxEntry([
			{ currencyCodes: [kta, doge], to: [pepe, doge] },
			{ currencyCodes: [doge, kta], to: [pepe] }
		])]
	]);
	const result = pruneFX(entries);
	assert.deepEqual(result.warnings, [`fx/a: removed token ${doge}`]);
});

test('pruneFX strips the signature only when the entry changed', () => {
	const signed = { account: murphyAccount, signed: { nonce: 'n', timestamp: 't', signature: 's' }, name: 'kept' };
	const entries: EntryMap = new Map([
		['$KTA', kta],
		['$PEPE', pepe],
		['fx/changed', fxEntry([{ currencyCodes: [kta], to: [pepe, doge] }], signed)],
		['fx/same', fxEntry([{ currencyCodes: [kta], to: [pepe] }], signed)]
	]);
	const result = pruneFX(entries);
	assert.deepEqual(result.entries.get('fx/changed'), fxEntry([{ currencyCodes: [kta], to: [pepe] }], { name: 'kept' }));
	assert.deepEqual(result.entries.get('fx/same'), entries.get('fx/same'));
	assert.deepEqual(result.warnings, [
		`fx/changed: removed token ${doge}`,
		'fx/changed: signature removed (entry modified)'
	]);
});

test('pruneFX does not mutate the input', () => {
	const entries: EntryMap = new Map([
		['$KTA', kta],
		['fx/a', fxEntry([{ currencyCodes: [kta], to: [doge, kta] }], { account: murphyAccount })]
	]);
	const before = canonicalJSON(unflatten(entries));
	pruneFX(entries);
	assert.equal(canonicalJSON(unflatten(entries)), before);
});

test('pruneFX gives byte-identical output for any input order', () => {
	const list: [string, JSONValue][] = [
		['$KTA', kta],
		['$PEPE', pepe],
		['fx/b', fxEntry([{ currencyCodes: [kta], to: [doge, pepe] }])],
		['fx/a', fxEntry([{ currencyCodes: [doge], to: [kta] }])],
		['fx/c', fxEntry([{ currencyCodes: [pepe, doge], to: [kta] }])]
	];
	const first = pruneFX(new Map(list));
	const second = pruneFX(new Map([...list].reverse()));
	assert.equal(canonicalJSON(unflatten(second.entries)), canonicalJSON(unflatten(first.entries)));
	assert.deepEqual(second.warnings, first.warnings);
});
