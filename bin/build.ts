// SPDX-License-Identifier: MPL-2.0
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNetwork, readNetworkInput } from '../src/build.ts';
import { ToolError } from '../src/errors.ts';
import { decodeNetworkAlias } from '../src/network.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

function fail(message: string): never {
	process.stderr.write(`error: ${message}\n`);
	process.exit(1);
}

async function main(): Promise<void> {
	const [networkText, outputPath, ...rest] = process.argv.slice(2);
	if (networkText === undefined || outputPath === undefined || rest.length !== 0) {
		fail('usage: node bin/build.ts <network> <outputPath>');
	}

	const network = decodeNetworkAlias(networkText);
	const input = readNetworkInput(path.join(root, 'networks', network));
	const result = await buildNetwork(input);
	for (const warning of result.warnings) {
		process.stderr.write(`warning: ${warning}\n`);
	}

	// Rename is atomic, so a failed write never replaces the previous output.
	const temporaryPath = `${outputPath}.tmp`;
	try {
		fs.writeFileSync(temporaryPath, result.output);
		fs.renameSync(temporaryPath, outputPath);
	} catch (error) {
		fs.rmSync(temporaryPath, { force: true });
		throw(error);
	}
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
