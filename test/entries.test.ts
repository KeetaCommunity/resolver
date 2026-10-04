// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { decodeEntryKey, encodeEntryKey } from '../src/entries.ts';
import { decodeNetworkAlias } from '../src/network.ts';
import { ToolError } from '../src/errors.ts';

test('service key round-trips, split on first slash', () => {
	const key = decodeEntryKey('fx/team/a');
	assert.deepEqual(key, { kind: 'service', serviceType: 'fx', serviceID: 'team/a' });
	assert.equal(encodeEntryKey(key), 'fx/team/a');
});
test('currency key round-trips', () => {
	assert.deepEqual(decodeEntryKey('$MURF'), { kind: 'currency', currencyCode: '$MURF' });
	assert.equal(encodeEntryKey({ kind: 'currency', currencyCode: 'USD' }), 'USD');
});
test('rejects unknown service type and empty parts', () => {
	for (const bad of ['nope/x', 'fx/', '/x', '']) {
		assert.throws(() => decodeEntryKey(bad), (error) => ToolError.isInstance(error) && error.code === 'INVALID_ENTRY_KEY');
	}
});
test('decodeNetworkAlias accepts main and test only', () => {
	assert.equal(decodeNetworkAlias('main'), 'main');
	assert.throws(() => decodeNetworkAlias('staging'));
});
