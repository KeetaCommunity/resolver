// SPDX-License-Identifier: MPL-2.0
import type { Merged } from './merge.ts';
import { sameJSON } from './json.ts';

type ReportInput = {
	// Undefined when that build failed; no entry lines are then possible.
	before: Merged | undefined;
	after: Merged | undefined;
	// Source ID to the message of the failed fetch.
	fetchFailures: Map<string, string>;
	warnings: string[];
	buildError: string | undefined;
};

const markers = ['+', '~', '-', '!'];

function compare(a: string, b: string): number {
	if (a < b) {
		return(-1);
	}
	if (a > b) {
		return(1);
	}
	return(0);
}

function addLine(sections: Map<string, Map<string, string[]>>, sourceID: string, marker: string, text: string): void {
	let section = sections.get(sourceID);
	if (section === undefined) {
		section = new Map();
		sections.set(sourceID, section);
	}
	let lines = section.get(marker);
	if (lines === undefined) {
		lines = [];
		section.set(marker, lines);
	}
	lines.push(text);
}

/*
 * One fact per line, grouped by source. An entry shared by several sources is
 * listed under each of them. A source that only gains or loses a share of an
 * entry with an unchanged value has nothing to report.
 */
function formatReport(input: ReportInput): string {
	const sections = new Map<string, Map<string, string[]>>();

	const { before, after } = input;
	if (before !== undefined && after !== undefined) {
		const keys = new Set([...before.entries.keys(), ...after.entries.keys()]);
		for (const key of keys) {
			const oldValue = before.entries.get(key);
			const newValue = after.entries.get(key);
			const oldSources = before.provenance.get(key) ?? [];
			const newSources = after.provenance.get(key) ?? [];
			const changed = oldValue !== undefined && newValue !== undefined && !sameJSON(oldValue, newValue);

			for (const sourceID of new Set([...oldSources, ...newSources])) {
				const wasThere = oldSources.includes(sourceID);
				const isThere = newSources.includes(sourceID);
				if (oldValue === undefined && isThere) {
					addLine(sections, sourceID, '+', key);
				} else if (newValue === undefined && wasThere) {
					addLine(sections, sourceID, '-', key);
				} else if (changed) {
					addLine(sections, sourceID, '~', key);
				}
			}
		}
	}

	for (const [sourceID, message] of input.fetchFailures) {
		addLine(sections, sourceID, '!', `fetch failed: ${message}`);
	}

	const lines: string[] = [];
	for (const sourceID of [...sections.keys()].sort(compare)) {
		const section = sections.get(sourceID);
		if (section === undefined) {
			continue;
		}
		lines.push(`## ${sourceID}`);
		for (const marker of markers) {
			for (const text of (section.get(marker) ?? []).sort(compare)) {
				lines.push(`${marker} ${text}`);
			}
		}
	}

	lines.push('## build');
	if (input.buildError === undefined) {
		lines.push('ok');
	} else {
		lines.push(`! ${input.buildError}`);
	}
	for (const warning of input.warnings) {
		lines.push(`? ${warning}`);
	}

	return(lines.join('\n') + '\n');
}

export { formatReport };
export type { ReportInput };
