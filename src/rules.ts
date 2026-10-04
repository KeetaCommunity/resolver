// SPDX-License-Identifier: MPL-2.0
import { ToolError } from './errors.ts';
import type { EntryMap } from './entries.ts';
import type { Source } from './sources.ts';

function select(source: Source, entries: EntryMap, warnings: string[]): EntryMap {
	const { selection } = source;

	if (selection.kind === 'all') {
		return(new Map(entries));
	}

	if (selection.kind === 'include') {
		for (const key of selection.keys) {
			if (!entries.has(key)) {
				throw(new ToolError('RULE_TARGET_MISSING', `${source.sourceID} include target missing: ${key}`));
			}
		}
		const kept: EntryMap = new Map();
		for (const [key, value] of entries) {
			if (selection.keys.includes(key)) {
				kept.set(key, value);
			}
		}
		return(kept);
	}

	// A stale exclude is harmless, so it only warns.
	for (const key of selection.keys) {
		if (!entries.has(key)) {
			warnings.push(`exclude target missing: ${source.sourceID} ${key}`);
		}
	}
	const kept: EntryMap = new Map();
	for (const [key, value] of entries) {
		if (!selection.keys.includes(key)) {
			kept.set(key, value);
		}
	}
	return(kept);
}

/*
 * Selection first, then renames. A rename target must not be a key of the
 * selected entries nor the target of another rename, so a rename never
 * overwrites an entry.
 */
function applyRules(source: Source, entries: EntryMap): { entries: EntryMap; warnings: string[] } {
	const warnings: string[] = [];
	const selected = select(source, entries, warnings);

	for (const from of source.rename.keys()) {
		if (!selected.has(from)) {
			throw(new ToolError('RULE_TARGET_MISSING', `${source.sourceID} rename target missing: ${from}`));
		}
	}

	const targets = new Set<string>();
	for (const [from, to] of source.rename) {
		if (selected.has(to) || targets.has(to)) {
			throw(new ToolError('RENAME_COLLISION', `${source.sourceID} rename collision: ${from} -> ${to}`));
		}
		targets.add(to);
	}

	const result: EntryMap = new Map();
	for (const [key, value] of selected) {
		result.set(source.rename.get(key) ?? key, value);
	}

	return({ entries: result, warnings });
}

export { applyRules };
