// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { decodeSources } from '../src/sources.ts';
import { ToolError } from '../src/errors.ts';

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
