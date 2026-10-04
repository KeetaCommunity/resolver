// SPDX-License-Identifier: MPL-2.0
import * as KeetaNet from '@keetanetwork/keetanet-client';
import { decodeEntryKey } from './entries.ts';
import type { EntryMap } from './entries.ts';
import { ToolError } from './errors.ts';
import type { JSONValue } from './json.ts';

type JSONObject = { [key: string]: JSONValue };

type Rule = {
	raw: JSONObject;
	currencyCodes: string[];
	to: string[];
};

function isObject(value: JSONValue | undefined): value is JSONObject {
	return(typeof value === 'object' && value !== null && !Array.isArray(value));
}

function isStringArray(value: JSONValue | undefined): value is string[] {
	if (!Array.isArray(value)) {
		return(false);
	}
	return(value.every((item) => {
		return(typeof item === 'string');
	}));
}

function describe(value: JSONValue): string {
	if (typeof value === 'string') {
		return(value);
	}
	return(JSON.stringify(value));
}

// `fromPublicKeyString` throws for anything that is not an account.
function isTokenAddress(value: unknown): boolean {
	if (typeof value !== 'string') {
		return(false);
	}

	try {
		return(KeetaNet.lib.Account.fromPublicKeyString(value).isToken());
	} catch {
		return(false);
	}
}

function compare(a: string, b: string): number {
	if (a < b) {
		return(-1);
	}
	if (a > b) {
		return(1);
	}
	return(0);
}

// Keys of the `fx/*` entries, sorted so the result does not depend on the map order.
function fxKeys(entries: EntryMap): string[] {
	const keys: string[] = [];
	for (const text of entries.keys()) {
		const key = decodeEntryKey(text);
		if (key.kind === 'service' && key.serviceType === 'fx') {
			keys.push(text);
		}
	}

	return(keys.sort(compare));
}

function readRules(entry: JSONValue | undefined): Rule[] | undefined {
	if (!isObject(entry) || !Array.isArray(entry['from'])) {
		return(undefined);
	}

	const rules: Rule[] = [];
	for (const raw of entry['from']) {
		if (!isObject(raw)) {
			return(undefined);
		}
		const { currencyCodes, to } = raw;
		if (!isStringArray(currencyCodes) || !isStringArray(to)) {
			return(undefined);
		}
		rules.push({ raw, currencyCodes, to });
	}

	return(rules);
}

function listedTokens(entries: EntryMap): Set<string> {
	const tokens = new Set<string>();
	for (const [text, value] of entries) {
		if (decodeEntryKey(text).kind === 'currency' && typeof value === 'string') {
			tokens.add(value);
		}
	}

	return(tokens);
}

/*
 * Run on one source's kept entries. `listed` is what the source lists before
 * its `exclude`, so excluding a currency does not fail an fx entry that stays.
 */
function checkSourceTokens(sourceID: string, kept: EntryMap, listed: Set<string>): void {
	for (const [text, value] of kept) {
		if (decodeEntryKey(text).kind === 'currency' && !isTokenAddress(value)) {
			throw(new ToolError('INVALID_TOKEN', `${sourceID} ${text}: not a token address: ${describe(value)}`));
		}
	}

	for (const text of fxKeys(kept)) {
		const rules = readRules(kept.get(text));
		if (rules === undefined) {
			throw(new ToolError('INVALID_DOCUMENT', `${sourceID} ${text}: malformed from`));
		}
		for (const rule of rules) {
			for (const token of [...rule.currencyCodes, ...rule.to]) {
				if (!isTokenAddress(token)) {
					throw(new ToolError('INVALID_TOKEN', `${sourceID} ${text}: not a token address: ${token}`));
				}
				if (!listed.has(token)) {
					throw(new ToolError('FX_TOKEN_UNLISTED', `${sourceID} ${text}: token not in currencyMap: ${token}`));
				}
			}
		}
	}
}

/*
 * Keeps the fx rules to the tokens of the final currencyMap. An entry we
 * change is no longer what the anchor signed, so it loses `account` and
 * `signed`; an entry we leave alone keeps them.
 */
function pruneFX(entries: EntryMap): { entries: EntryMap; warnings: string[] } {
	const final = listedTokens(entries);
	const result: EntryMap = new Map(entries);
	const warnings: string[] = [];

	for (const text of fxKeys(entries)) {
		const entry = entries.get(text);
		const rules = readRules(entry);
		if (!isObject(entry) || rules === undefined) {
			throw(new ToolError('INVALID_DOCUMENT', `${text}: malformed from`));
		}

		const removed = new Set<string>();
		let changed = false;
		const kept: JSONValue[] = [];
		for (const rule of rules) {
			const currencyCodes = rule.currencyCodes.filter((token) => {
				return(final.has(token));
			});
			const to = rule.to.filter((token) => {
				return(final.has(token));
			});
			for (const token of [...rule.currencyCodes, ...rule.to]) {
				if (!final.has(token) && !removed.has(token)) {
					removed.add(token);
					warnings.push(`${text}: removed token ${token}`);
				}
			}
			if (currencyCodes.length !== rule.currencyCodes.length || to.length !== rule.to.length) {
				changed = true;
			}
			if (currencyCodes.length === 0 || to.length === 0) {
				changed = true;
				continue;
			}
			kept.push({ ...rule.raw, currencyCodes, to });
		}

		if (!changed && kept.length > 0) {
			continue;
		}
		if (kept.length === 0) {
			result.delete(text);
			warnings.push(`${text}: removed (no pairs left)`);
			continue;
		}

		const modified: JSONObject = {};
		for (const [field, value] of Object.entries(entry)) {
			if (field === 'account' || field === 'signed') {
				continue;
			}
			Object.defineProperty(modified, field, { value, enumerable: true, writable: true, configurable: true });
		}
		Object.defineProperty(modified, 'from', { value: kept, enumerable: true, writable: true, configurable: true });
		result.set(text, modified);
		if (entry['account'] !== undefined || entry['signed'] !== undefined) {
			warnings.push(`${text}: signature removed (entry modified)`);
		}
	}

	return({ entries: result, warnings });
}

export { isTokenAddress, listedTokens, checkSourceTokens, pruneFX };
