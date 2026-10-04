// SPDX-License-Identifier: MPL-2.0
import * as KeetaNet from '@keetanetwork/keetanet-client';
import { decodeEntryKey } from './entries.ts';
import type { EntryKey } from './entries.ts';
import { ToolError } from './errors.ts';
import type { JSONValue } from './json.ts';
import { isCanonicalCurrencyCode, isTokenAddress } from './tokens.ts';

type JSONObject = { [key: string]: JSONValue };

type Selection = {
	kind: 'all';
} | {
	kind: 'include';
	keys: string[];
} | {
	kind: 'exclude';
	keys: string[];
};

type Source = {
	sourceID: string;
	url: string;
	selection: Selection;
	// Source entry key to the key it is published under.
	rename: Map<string, string>;
	// Currency code to token address, added to the snapshot before the rules.
	add: Map<string, string>;
};

const sourceFields = ['sourceID', 'url', 'include', 'exclude', 'rename', 'add'];

function invalid(path: string, reason: string): ToolError {
	return(new ToolError('INVALID_SOURCES', `${path}: ${reason}`));
}

function isObject(value: JSONValue | undefined): value is JSONObject {
	return(typeof value === 'object' && value !== null && !Array.isArray(value));
}

function checkFields(path: string, object: JSONObject, allowed: string[]): void {
	for (const field of Object.keys(object)) {
		if (!allowed.includes(field)) {
			throw(invalid(path, `unknown field ${field}`));
		}
	}
}

function decodeKey(path: string, text: JSONValue): EntryKey {
	if (typeof text !== 'string') {
		throw(invalid(path, 'not a string'));
	}

	try {
		return(decodeEntryKey(text));
	} catch (error) {
		if (ToolError.isInstance(error)) {
			throw(invalid(path, error.message));
		}
		throw(error);
	}
}

function decodeKeyList(path: string, value: JSONValue): string[] {
	if (!Array.isArray(value)) {
		throw(invalid(path, 'not an array'));
	}

	return(value.map((item, index) => {
		decodeKey(`${path}[${index}]`, item);
		// decodeKey proved it is a string.
		return(String(item));
	}));
}

function decodeURLField(path: string, value: JSONValue | undefined): string {
	if (typeof value !== 'string') {
		throw(invalid(path, 'required string'));
	}

	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw(invalid(path, `invalid url ${value}`));
	}

	if (url.protocol !== 'https:' && url.protocol !== 'keetanet:') {
		throw(invalid(path, `unsupported protocol ${url.protocol}`));
	}
	if (url.username !== '' || url.password !== '') {
		throw(invalid(path, 'credentials not allowed'));
	}
	if (url.hash !== '') {
		throw(invalid(path, 'fragment not allowed'));
	}
	if (url.protocol === 'https:') {
		return(value);
	}

	if (url.port !== '') {
		throw(invalid(path, 'port not allowed for keetanet'));
	}
	if (url.search !== '') {
		throw(invalid(path, 'query not allowed for keetanet'));
	}
	if (url.pathname !== '/metadata') {
		throw(invalid(path, 'keetanet url must be keetanet://<account>/metadata'));
	}
	// The parser keeps the host's case, so an uppercase account fails here too.
	try {
		KeetaNet.lib.Account.fromPublicKeyString(url.hostname);
	} catch {
		throw(invalid(path, 'invalid account'));
	}

	return(value);
}

function decodeRename(path: string, value: JSONValue): Map<string, string> {
	if (!isObject(value)) {
		throw(invalid(path, 'not an object'));
	}

	const rename = new Map<string, string>();
	for (const [from, to] of Object.entries(value)) {
		const fromKey = decodeKey(`${path}.${from}`, from);
		const toKey = decodeKey(`${path}.${from}`, to);
		if (fromKey.kind !== 'service' || toKey.kind !== 'service') {
			throw(invalid(`${path}.${from}`, 'only service entries can be renamed'));
		}
		if (fromKey.serviceType !== toKey.serviceType) {
			throw(invalid(`${path}.${from}`, `cannot rename ${fromKey.serviceType} to ${toKey.serviceType}`));
		}
		rename.set(from, String(to));
	}

	return(rename);
}

function decodeAdd(path: string, value: JSONValue): Map<string, string> {
	if (!isObject(value)) {
		throw(invalid(path, 'not an object'));
	}

	const add = new Map<string, string>();
	for (const [code, address] of Object.entries(value)) {
		const key = decodeKey(`${path}.${code}`, code);
		if (key.kind !== 'currency') {
			throw(invalid(`${path}.${code}`, 'only currency entries can be added'));
		}
		if (!isCanonicalCurrencyCode(code)) {
			throw(invalid(`${path}.${code}`, 'not a canonical currency code'));
		}
		if (typeof address !== 'string' || !isTokenAddress(address)) {
			throw(invalid(`${path}.${code}`, 'not a token address'));
		}
		add.set(code, address);
	}

	return(add);
}

function decodeSource(path: string, value: JSONValue, seen: Set<string>): Source {
	if (!isObject(value)) {
		throw(invalid(path, 'not an object'));
	}
	checkFields(path, value, sourceFields);

	const sourceID = value.sourceID;
	if (typeof sourceID !== 'string') {
		throw(invalid(`${path}.sourceID`, 'required string'));
	}
	if (!/^[a-z0-9-]+$/.test(sourceID)) {
		throw(invalid(`${path}.sourceID`, `must match [a-z0-9-]+: ${sourceID}`));
	}
	if (seen.has(sourceID)) {
		throw(invalid(`${path}.sourceID`, `duplicate sourceID ${sourceID}`));
	}
	seen.add(sourceID);

	const url = decodeURLField(`${path}.url`, value.url);

	if (value.include !== undefined && value.exclude !== undefined) {
		throw(invalid(path, 'include and exclude are mutually exclusive'));
	}

	let selection: Selection = { kind: 'all' };
	if (value.include !== undefined) {
		selection = { kind: 'include', keys: decodeKeyList(`${path}.include`, value.include) };
	}
	if (value.exclude !== undefined) {
		selection = { kind: 'exclude', keys: decodeKeyList(`${path}.exclude`, value.exclude) };
	}

	let rename = new Map<string, string>();
	if (value.rename !== undefined) {
		rename = decodeRename(`${path}.rename`, value.rename);
	}

	let add = new Map<string, string>();
	if (value.add !== undefined) {
		add = decodeAdd(`${path}.add`, value.add);
	}

	return({ sourceID, url, selection, rename, add });
}

function decodeSources(text: string): Source[] {
	let parsed: JSONValue;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw(invalid('sources.json', `not valid JSON: ${String(error)}`));
	}

	if (!isObject(parsed)) {
		throw(invalid('sources.json', 'not an object'));
	}
	checkFields('sources.json', parsed, ['version', 'sources']);

	if (parsed.version !== 1) {
		throw(invalid('version', 'must be 1'));
	}
	if (!Array.isArray(parsed.sources)) {
		throw(invalid('sources', 'required array'));
	}

	const seen = new Set<string>();
	return(parsed.sources.map((item, index) => {
		return(decodeSource(`sources[${index}]`, item, seen));
	}));
}

export { decodeSources };
export type { Selection, Source };
