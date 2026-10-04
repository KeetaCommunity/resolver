// SPDX-License-Identifier: MPL-2.0
import * as fs from 'node:fs';
import * as path from 'node:path';
import { unflatten } from './entries.ts';
import type { EntryMap, ResolverDocument } from './entries.ts';
import { ToolError } from './errors.ts';
import { canonicalJSON } from './json.ts';
import { mergeContributions } from './merge.ts';
import type { Contribution, Merged } from './merge.ts';
import { applyRules } from './rules.ts';
import { decodeSnapshot } from './snapshot.ts';
import type { Snapshot } from './snapshot.ts';
import { decodeSources } from './sources.ts';
import type { Source } from './sources.ts';
import { checkSourceTokens, listedTokens, pruneFX } from './tokens.ts';
import { checkEntrySignatures, validateDocument } from './validate.ts';

type NetworkInput = {
	sources: Source[];
	// Keyed by the snapshot file's base name, without `.json`.
	snapshots: Map<string, Snapshot>;
};

type BuildResult = {
	document: ResolverDocument;
	output: string;
	merged: Merged;
	warnings: string[];
};

const snapshotExtension = '.json';

/*
 * The only reader of network input on disk. Names are sorted so the result
 * does not depend on the directory order. A missing `snapshots/` directory
 * means no snapshots.
 */
function readNetworkInput(directory: string): NetworkInput {
	const sources = decodeSources(fs.readFileSync(path.join(directory, 'sources.json'), 'utf8'));

	const snapshots = new Map<string, Snapshot>();
	const snapshotDirectory = path.join(directory, 'snapshots');
	if (!fs.existsSync(snapshotDirectory)) {
		return({ sources, snapshots });
	}

	const files = fs.readdirSync(snapshotDirectory).filter((file) => {
		return(file.endsWith(snapshotExtension));
	}).sort();
	for (const file of files) {
		const name = file.slice(0, -snapshotExtension.length);
		snapshots.set(name, decodeSnapshot(fs.readFileSync(path.join(snapshotDirectory, file), 'utf8')));
	}

	return({ sources, snapshots });
}

function checkInput(input: NetworkInput): void {
	const sourceIDs = new Set(input.sources.map((source) => {
		return(source.sourceID);
	}));

	for (const source of input.sources) {
		if (!input.snapshots.has(source.sourceID)) {
			throw(new ToolError('SNAPSHOT_MISSING', source.sourceID));
		}
	}
	for (const name of input.snapshots.keys()) {
		if (!sourceIDs.has(name)) {
			throw(new ToolError('SNAPSHOT_ORPHAN', name));
		}
	}
	for (const source of input.sources) {
		const snapshot = input.snapshots.get(source.sourceID);
		if (snapshot === undefined || snapshot.sourceID !== source.sourceID || snapshot.url !== source.url) {
			throw(new ToolError('SNAPSHOT_MISMATCH', source.sourceID));
		}
	}
}

async function buildNetwork(input: NetworkInput): Promise<BuildResult> {
	checkInput(input);

	const warnings: string[] = [];
	const contributions: Contribution[] = [];
	for (const source of input.sources) {
		const snapshot = input.snapshots.get(source.sourceID);
		if (snapshot === undefined) {
			throw(new ToolError('SNAPSHOT_MISSING', source.sourceID));
		}
		// What the source lists: its snapshot plus `add`, before `exclude`.
		const listing: EntryMap = new Map(snapshot.entries);
		for (const [code, address] of source.add) {
			if (listing.has(code)) {
				throw(new ToolError('ADD_COLLISION', `${source.sourceID} add ${code}: already in source`));
			}
			listing.set(code, address);
		}
		const listed = listedTokens(listing);

		const ruled = applyRules(source, listing);
		warnings.push(...ruled.warnings);
		checkSourceTokens(source.sourceID, ruled.entries, listed);
		// Against the upstream content, before pruneFX changes anything.
		await checkEntrySignatures(source.sourceID, ruled.entries);
		contributions.push({ sourceID: source.sourceID, entries: ruled.entries });
	}

	const unpruned = mergeContributions(contributions);
	const pruned = pruneFX(unpruned.entries);
	warnings.push(...pruned.warnings);
	// Provenance follows the entries, so the diff does not report a removed entry as added.
	const provenance = new Map<string, string[]>();
	for (const [key, sourceIDs] of unpruned.provenance) {
		if (pruned.entries.has(key)) {
			provenance.set(key, sourceIDs);
		}
	}
	const merged: Merged = { entries: pruned.entries, provenance };
	const document = unflatten(merged.entries);
	await validateDocument(document);

	const output = canonicalJSON(document);

	return({ document, output, merged, warnings });
}

export { buildNetwork, readNetworkInput };
export type { NetworkInput, BuildResult };
