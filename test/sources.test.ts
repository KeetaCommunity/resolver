// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { decodeSources } from '../src/sources.ts';
import { ToolError } from '../src/errors.ts';

const murphy = 'keeta_athqkb6yw6h2e436xxaakuy4bctrqkqfctvy5xsp3ugvb3avv56zruxjcxauq';

const valid = `{
	"version": 1,
	"sources": [
		{ "sourceID": "murphy", "url": "keetanet://keeta_athqkb6yw6h2e436xxaakuy4bctrqkqfctvy5xsp3ugvb3avv56zruxjcxauq/metadata" },
		{ "sourceID": "velocity", "url": "keetanet://keeta_aab2lqgwz56u6dvfbqtsadcnfc2y4wdvl7rd2pkboxoray5mj3hmdzot2neu4wq/metadata",
			"exclude": ["fx/test-anchor", "$TEST"] },
		{ "sourceID": "acme", "url": "https://acme.example/meta.json",
			"include": ["fx/acme", "$ACME"],
			"rename": { "fx/acme": "fx/acme-community" } }
	]
}`;

function withSources(sources: object[]): string {
	return(JSON.stringify({ version: 1, sources }));
}

function withSource(fields: object): string {
	return(withSources([{ sourceID: 'a', url: 'https://a.example/m.json', ...fields }]));
}

function isInvalidSources(error: unknown): boolean {
	return(ToolError.isInstance(error) && error.code === 'INVALID_SOURCES');
}

test('decodes the spec example', () => {
	const sources = decodeSources(valid);
	assert.equal(sources.length, 3);

	const [murphy, velocity, acme] = sources;
	assert.deepEqual(murphy?.selection, { kind: 'all' });
	assert.equal(murphy?.rename.size, 0);
	assert.deepEqual(velocity?.selection, { kind: 'exclude', keys: ['fx/test-anchor', '$TEST'] });
	assert.deepEqual(acme?.selection, { kind: 'include', keys: ['fx/acme', '$ACME'] });
	assert.equal(acme?.rename.get('fx/acme'), 'fx/acme-community');
});

test('rejects invalid sources', () => {
	const cases: { name: string; text: string }[] = [
		{ name: 'version 2', text: JSON.stringify({ version: 2, sources: [] }) },
		{ name: 'duplicate sourceID', text: withSources([
			{ sourceID: 'a', url: 'https://a.example/m.json' },
			{ sourceID: 'a', url: 'https://b.example/m.json' }
		]) },
		{ name: 'bad sourceID', text: withSource({ sourceID: 'Bad_ID' }) },
		{ name: 'http url', text: withSource({ url: 'http://x' }) },
		{ name: 'keetanet url with other path', text: withSource({ url: 'keetanet://keeta_x/other' }) },
		{ name: 'https credentials', text: withSource({ url: 'https://user:pass@a.example/m.json' }) },
		{ name: 'https username', text: withSource({ url: 'https://user@a.example/m.json' }) },
		{ name: 'https fragment', text: withSource({ url: 'https://a.example/m.json#x' }) },
		{ name: 'keetanet credentials', text: withSource({ url: `keetanet://user:pass@${murphy}/metadata` }) },
		{ name: 'keetanet fragment', text: withSource({ url: `keetanet://${murphy}/metadata#x` }) },
		{ name: 'keetanet port', text: withSource({ url: `keetanet://${murphy}:80/metadata` }) },
		{ name: 'keetanet query', text: withSource({ url: `keetanet://${murphy}/metadata?x=1` }) },
		{ name: 'keetanet invalid account', text: withSource({ url: 'keetanet://keeta_x/metadata' }) },
		{ name: 'keetanet uppercase account', text: withSource({ url: `keetanet://${murphy.toUpperCase()}/metadata` }) },
		{ name: 'include with exclude', text: withSource({ include: ['$A'], exclude: ['$B'] }) },
		{ name: 'bad include key', text: withSource({ include: ['nope/x'] }) },
		{ name: 'rename across service types', text: withSource({ rename: { 'fx/a': 'kyc/a' } }) },
		{ name: 'currency rename', text: withSource({ rename: { $A: '$B' } }) },
		{ name: 'unknown source field', text: withSource({ excludes: [] }) },
		{ name: 'unknown top-level field', text: JSON.stringify({ version: 1, sources: [], extra: 1 }) },
		{ name: 'not JSON', text: 'not json' }
	];

	for (const { name, text } of cases) {
		assert.throws(() => decodeSources(text), isInvalidSources, name);
	}
});

test('error messages name the field path', () => {
	assert.throws(() => decodeSources(withSources([
		{ sourceID: 'a', url: 'https://a.example/m.json' },
		{ sourceID: 'b', url: 'http://x' }
	])), { message: 'sources[1].url: unsupported protocol http:' });
});

test('https urls may carry a query and a port', () => {
	const sources = decodeSources(withSource({ url: 'https://a.example:8443/m.json?x=1' }));
	assert.equal(sources[0]?.url, 'https://a.example:8443/m.json?x=1');
});

test('url errors name the rejected part', () => {
	const cases: { url: string; message: string }[] = [
		{ url: 'https://user:pass@a.example/m.json', message: 'sources[0].url: credentials not allowed' },
		{ url: 'https://a.example/m.json#x', message: 'sources[0].url: fragment not allowed' },
		{ url: `keetanet://${murphy}:80/metadata`, message: 'sources[0].url: port not allowed for keetanet' },
		{ url: `keetanet://${murphy}/metadata?x=1`, message: 'sources[0].url: query not allowed for keetanet' },
		{ url: 'keetanet://keeta_x/metadata', message: 'sources[0].url: invalid account' }
	];

	for (const { url, message } of cases) {
		assert.throws(() => decodeSources(withSource({ url })), { message }, url);
	}
});

const kta = 'keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg';

test('add decodes to a map and defaults to empty', () => {
	const [withAdd, without] = decodeSources(withSources([
		{ sourceID: 'a', url: 'https://a.example/m.json', add: { $KTA: kta } },
		{ sourceID: 'b', url: 'https://b.example/m.json' }
	]));
	assert.deepEqual([...(withAdd?.add ?? [])], [['$KTA', kta]]);
	assert.equal(without?.add.size, 0);
});

test('rejects invalid add', () => {
	const cases: { name: string; add: unknown; message: string }[] = [
		{ name: 'not an object', add: [kta], message: 'sources[0].add: not an object' },
		{ name: 'null', add: null, message: 'sources[0].add: not an object' },
		{ name: 'service key', add: { 'fx/a': kta }, message: 'sources[0].add.fx/a: only currency entries can be added' },
		{ name: 'non-token account', add: { $A: murphy }, message: 'sources[0].add.$A: not a token address' },
		{ name: 'ticker', add: { $A: '$KTA' }, message: 'sources[0].add.$A: not a token address' },
		{ name: 'not a string', add: { $A: 5 }, message: 'sources[0].add.$A: not a token address' },
		{ name: 'non-canonical code', add: { USDC: kta }, message: 'sources[0].add.USDC: not a canonical currency code' },
		{ name: 'lowercase code', add: { kta: kta }, message: 'sources[0].add.kta: not a canonical currency code' },
		{ name: 'prototype key', add: { ['__proto__']: kta }, message: 'sources[0].add.__proto__: not a canonical currency code' },
		{ name: 'newline in code', add: { '$X\nY': kta }, message: 'sources[0].add.$X\nY: not a canonical currency code' },
		{ name: 'non-keeta encoding', add: { $A: `tyblocks_${kta.slice('keeta_'.length)}` }, message: 'sources[0].add.$A: not a token address' }
	];

	for (const { name, add, message } of cases) {
		assert.throws(() => decodeSources(withSource({ add })), { name: 'ToolError', code: 'INVALID_SOURCES', message }, name);
	}
});
