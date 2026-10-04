// SPDX-License-Identifier: MPL-2.0
import { buildNetwork } from './build.ts';
import type { BuildResult, NetworkInput } from './build.ts';
import { formatReport } from './diff.ts';
import type { EntryMap } from './entries.ts';
import { ToolError } from './errors.ts';
import type { Snapshot } from './snapshot.ts';
import type { Source } from './sources.ts';

type DetectResult = {
	changed: boolean;
	// The fresh snapshots of the sources that were fetched successfully.
	snapshots: Snapshot[];
	body: string;
};

type FetchEntries = (source: Source) => Promise<{ entries: EntryMap; warnings: string[] }>;

type Attempt = {
	result: BuildResult | undefined;
	// `<code>: <message>` of a failed build.
	error: string | undefined;
};

function describeError(error: unknown): string {
	if (error instanceof Error) {
		return(error.message);
	}
	return(String(error));
}

async function attemptBuild(input: NetworkInput): Promise<Attempt> {
	try {
		return({ result: await buildNetwork(input), error: undefined });
	} catch (error) {
		if (ToolError.isInstance(error)) {
			return({ result: undefined, error: `${error.code}: ${error.message}` });
		}
		return({ result: undefined, error: `UNKNOWN: ${describeError(error)}` });
	}
}

function comparisonKey(attempt: Attempt): string {
	if (attempt.result === undefined) {
		return(`error: ${attempt.error}`);
	}
	return(attempt.result.output);
}

function unique(items: string[]): string[] {
	return([...new Set(items)]);
}

/*
 * Compares what would be published now with what is published from the
 * committed snapshots. Changes to entries that are not published give the same
 * output, so they are not a change. Any error from a fetch is a fetch failure:
 * that source keeps its committed snapshot, so one bad source never blocks the
 * rest.
 */
async function detect(input: NetworkInput, fetchEntries: FetchEntries): Promise<DetectResult> {
	const freshInput: NetworkInput = { sources: input.sources, snapshots: new Map(input.snapshots) };
	const fetched: Snapshot[] = [];
	const fetchFailures = new Map<string, string>();
	const fetchWarnings: string[] = [];

	for (const source of input.sources) {
		try {
			const result = await fetchEntries(source);
			const snapshot: Snapshot = { sourceID: source.sourceID, url: source.url, entries: result.entries };
			fetched.push(snapshot);
			freshInput.snapshots.set(source.sourceID, snapshot);
			for (const warning of result.warnings) {
				fetchWarnings.push(`${source.sourceID}: ${warning}`);
			}
		} catch (error) {
			fetchFailures.set(source.sourceID, describeError(error));
		}
	}

	const before = await attemptBuild(input);
	const after = await attemptBuild(freshInput);

	let buildWarnings: string[] = [];
	if (after.result !== undefined) {
		buildWarnings = after.result.warnings;
	}

	const body = formatReport({
		before: before.result?.merged,
		after: after.result?.merged,
		fetchFailures,
		warnings: unique([...buildWarnings, ...fetchWarnings]),
		buildError: after.error
	});

	return({ changed: comparisonKey(before) !== comparisonKey(after), snapshots: fetched, body });
}

export { detect };
export type { DetectResult, FetchEntries };
