// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { canonicalJSON, sameJSON } from '../src/json.ts';

test('canonicalJSON sorts keys at every depth by code unit, keeps arrays', () => {
	assert.equal(canonicalJSON({ b: 1, B: [3, 1], a: { z: 1, $y: 2 } }),
		'{\n  "B": [\n    3,\n    1\n  ],\n  "a": {\n    "$y": 2,\n    "z": 1\n  },\n  "b": 1\n}\n');
});
test('canonicalJSON is independent of input key order', () => {
	assert.equal(canonicalJSON({ x: 1, y: { p: 1, q: 2 } }), canonicalJSON({ y: { q: 2, p: 1 }, x: 1 }));
});
test('canonicalJSON sorts keys inside arrays of objects', () => {
	assert.equal(canonicalJSON([{ b: 1, a: 2 }]), '[\n  {\n    "a": 2,\n    "b": 1\n  }\n]\n');
});
test('sameJSON ignores key order and tells values apart', () => {
	assert.ok(sameJSON({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }));
	assert.ok(!sameJSON({ a: 1 }, { a: 2 }));
	assert.ok(!sameJSON([1, 2], [2, 1]));
});
test('canonicalJSON orders integer-like keys by code unit too', () => {
	assert.equal(canonicalJSON({ 10: 1, 2: 2, $: 3, a: 4 }), '{\n  "$": 3,\n  "10": 1,\n  "2": 2,\n  "a": 4\n}\n');
});
