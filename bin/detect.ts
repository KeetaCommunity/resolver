// SPDX-License-Identifier: MPL-2.0
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readNetworkInput } from '../src/build.ts';
import { detect } from '../src/detect.ts';
import { ToolError } from '../src/errors.ts';
import { createFetchContext, fetchSource } from '../src/fetch.ts';
import { decodeNetworkAlias } from '../src/network.ts';
import { encodeSnapshot } from '../src/snapshot.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

function fail(message: string): never {
	process.stderr.write(`error: ${message}\n`);
	process.exit(1);
}

async function main(): Promise<void> {
	const [networkText, bodyPath, ...rest] = process.argv.slice(2);
	if (networkText === undefined || bodyPath === undefined || rest.length !== 0) {
		fail('usage: node bin/detect.ts <network> <bodyPath>');
	}

	const network = decodeNetworkAlias(networkText);
	const directory = path.join(root, 'networks', network);
	const input = readNetworkInput(directory);
	const context = createFetchContext({ network });
	const result = await detect(input, async (source) => {
		return(await fetchSource(source.url, context));
	});

	fs.writeFileSync(bodyPath, result.body);
	if (!result.changed) {
		process.stdout.write('unchanged\n');
		return;
	}

	const snapshotDirectory = path.join(directory, 'snapshots');
	fs.mkdirSync(snapshotDirectory, { recursive: true });
	for (const snapshot of result.snapshots) {
		fs.writeFileSync(path.join(snapshotDirectory, `${snapshot.sourceID}.json`), encodeSnapshot(snapshot));
	}
	process.stdout.write('changed\n');
}

try {
	await main();
} catch (error) {
	if (ToolError.isInstance(error)) {
		fail(`${error.code}: ${error.message}`);
	}
	if (error instanceof Error) {
		fail(error.message);
	}
	throw(error);
}

// The KeetaNet client keeps network handles open, so the process would not exit by itself.
process.exit(0);
