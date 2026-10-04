// SPDX-License-Identifier: MPL-2.0
import { decodeEntryKey } from './entries.ts';
import type { EntryMap } from './entries.ts';
import { ToolError } from './errors.ts';
import { canonicalJSON } from './json.ts';
import type { JSONValue } from './json.ts';

type JSONObject = { [key: string]: JSONValue };

// The raw, fully resolved entries of one source.
type Snapshot = {
	sourceID: string;
	url: string;
	entries: EntryMap;
};

const snapshotFields = ['version', 'sourceID', 'url', 'entries'];

function invalid(reason: string): ToolError {
	return(new ToolError('INVALID_SNAPSHOT', reason));
}

function isObject(value: JSONValue | undefined): value is JSONObject {
	return(typeof value === 'object' && value !== null && !Array.isArray(value));
}

/*
 * No timestamp, so refreshing an unchanged source gives identical bytes.
 * Object.fromEntries defines own properties, so a key of `__proto__` is kept.
 */
function encodeSnapshot(snapshot: Snapshot): string {
	return(canonicalJSON({
		version: 1,
		sourceID: snapshot.sourceID,
		url: snapshot.url,
		entries: Object.fromEntries(snapshot.entries)
	}));
}

function decodeSnapshot(text: string): Snapshot {
	let parsed: JSONValue;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw(invalid('not valid JSON'));
	}

	if (!isObject(parsed)) {
		throw(invalid('not an object'));
	}
	for (const field of Object.keys(parsed)) {
		if (!snapshotFields.includes(field)) {
			throw(invalid(`unknown field ${field}`));
		}
	}
	if (parsed.version !== 1) {
		throw(invalid('version is not 1'));
	}

	const { sourceID, url, entries: rawEntries } = parsed;
	if (typeof sourceID !== 'string') {
		throw(invalid('sourceID: required string'));
	}
	if (typeof url !== 'string') {
		throw(invalid('url: required string'));
	}
	if (!isObject(rawEntries)) {
		throw(invalid('entries: required object'));
	}

	const entries: EntryMap = new Map();
	for (const [key, value] of Object.entries(rawEntries)) {
		try {
			decodeEntryKey(key);
		} catch (error) {
			if (ToolError.isInstance(error)) {
				throw(invalid(`entries.${key}: ${error.message}`));
			}
			throw(error);
		}
		entries.set(key, value);
	}

	return({ sourceID, url, entries });
}

export { encodeSnapshot, decodeSnapshot };
export type { Snapshot };
