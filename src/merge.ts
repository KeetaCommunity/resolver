// SPDX-License-Identifier: MPL-2.0
import { ToolError } from './errors.ts';
import type { EntryMap } from './entries.ts';
import { sameJSON } from './json.ts';
import type { JSONValue } from './json.ts';

type Contribution = {
	sourceID: string;
	entries: EntryMap;
};

type Merged = {
	entries: EntryMap;
	// Source IDs per key, sorted.
	provenance: Map<string, string[]>;
};

const shortLength = 12;

function shortValue(value: JSONValue): string {
	if (typeof value === 'string') {
		if (value.length > shortLength) {
			return(value.slice(0, shortLength) + '…');
		}
		return(value);
	}
	if (typeof value === 'object' && value !== null) {
		return('{…}');
	}
	return(JSON.stringify(value));
}

/*
 * Entries stay whole: two entries for one key are equal or a conflict, never
 * combined field by field. Contributions are taken in sourceID order so the
 * result and the conflict message do not depend on the input order.
 */
function mergeContributions(contributions: Contribution[]): Merged {
	const sorted = [...contributions].sort((a, b) => {
		if (a.sourceID < b.sourceID) {
			return(-1);
		}
		if (a.sourceID > b.sourceID) {
			return(1);
		}
		return(0);
	});

	const entries: EntryMap = new Map();
	const provenance = new Map<string, string[]>();
	const firstSource = new Map<string, string>();

	for (const contribution of sorted) {
		for (const [key, value] of contribution.entries) {
			const existing = entries.get(key);
			const sources = provenance.get(key);
			const first = firstSource.get(key);

			if (existing === undefined || sources === undefined || first === undefined) {
				entries.set(key, value);
				provenance.set(key, [contribution.sourceID]);
				firstSource.set(key, contribution.sourceID);
				continue;
			}

			if (!sameJSON(existing, value)) {
				throw(new ToolError('CONFLICT', `${key} ${first}=${shortValue(existing)} ${contribution.sourceID}=${shortValue(value)}`));
			}
			if (!sources.includes(contribution.sourceID)) {
				sources.push(contribution.sourceID);
			}
		}
	}

	return({ entries, provenance });
}

export { mergeContributions };
export type { Contribution, Merged };
