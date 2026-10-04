// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { flatten, unflatten } from '../src/entries.ts';
import type { ResolverDocument } from '../src/entries.ts';
import { mergeContributions } from '../src/merge.ts';
import { validateDocument } from '../src/validate.ts';
import { ToolError } from '../src/errors.ts';
import type { JSONValue } from '../src/json.ts';

const sourceNames = ['murphy', 'changenow', 'pfp', 'alpaca', 'keetahub', 'velocity'];

function fixture(name: string): JSONValue {
	return(JSON.parse(fs.readFileSync(new URL(`./fixtures/sources/${name}.json`, import.meta.url), 'utf8')));
}

function changenowDocument(): ResolverDocument {
	return(unflatten(flatten(fixture('changenow')).entries));
}

function changenowEntry(document: ResolverDocument): { [key: string]: JSONValue } {
	const entry = document.services['assetMovement']?.['changenow-staging'];
	if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
		throw(new Error('changenow-staging entry missing from fixture'));
	}
	return(entry);
}

function validationError(message: string | RegExp): (error: unknown) => boolean {
	return((error) => {
		if (!ToolError.isInstance(error) || error.code !== 'VALIDATION') {
			return(false);
		}
		if (typeof message === 'string') {
			return(error.message === message);
		}
		return(message.test(error.message));
	});
}

test('the changenow fixture with its real signed entry validates', async () => {
	await validateDocument(changenowDocument());
});

test('a changed operation URL throws bad signature', async () => {
	const document = changenowDocument();
	const operations = changenowEntry(document)['operations'];
	if (typeof operations !== 'object' || operations === null || Array.isArray(operations)) {
		throw(new Error('operations missing from fixture'));
	}
	operations['initiateTransfer'] = 'https://evil.example/api/initiateTransfer';

	await assert.rejects(validateDocument(document), validationError('bad signature: assetMovement/changenow-staging'));
});

test('a missing signed field throws unsigned field', async () => {
	const document = changenowDocument();
	delete changenowEntry(document)['signed'];

	await assert.rejects(validateDocument(document), validationError('unsigned field: assetMovement/changenow-staging'));
});

test('a missing account field throws unsigned field', async () => {
	const document = changenowDocument();
	delete changenowEntry(document)['account'];

	await assert.rejects(validateDocument(document), validationError('unsigned field: assetMovement/changenow-staging'));
});

test('an account that is not a public key throws bad signature', async () => {
	const document = changenowDocument();
	changenowEntry(document)['account'] = 'not-an-account';

	await assert.rejects(validateDocument(document), validationError('bad signature: assetMovement/changenow-staging'));
});

test('a schema violation throws a schema error', async () => {
	const document = changenowDocument();
	document.currencyMap['$KTA'] = 42;

	await assert.rejects(validateDocument(document), validationError(/^schema: /));
});

test('all six fixtures merged together validate', async () => {
	const merged = mergeContributions(sourceNames.map((sourceID) => {
		return({ sourceID, entries: flatten(fixture(sourceID)).entries });
	}));

	await validateDocument(unflatten(merged.entries));
});
