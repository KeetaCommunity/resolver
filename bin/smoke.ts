// SPDX-License-Identifier: MPL-2.0
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolError } from '../src/errors.ts';
import { decodeNetworkAlias } from '../src/network.ts';
import { retryUntilClean, smokeOnce } from '../src/smoke.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

const defaultTimeoutSeconds = 720;
const intervalSeconds = 30;

function fail(message: string): never {
	process.stderr.write(`error: ${message}\n`);
	process.exit(1);
}

function decodeTimeout(text: string): number {
	if (!/^[0-9]+$/.test(text)) {
		fail('usage: node bin/smoke.ts <network> [--timeout <seconds>]');
	}
	return(Number(text));
}

async function main(): Promise<boolean> {
	const [networkText, ...rest] = process.argv.slice(2);
	let timeoutSeconds = defaultTimeoutSeconds;
	if (rest.length === 2 && rest[0] === '--timeout' && rest[1] !== undefined) {
		timeoutSeconds = decodeTimeout(rest[1]);
	} else if (rest.length !== 0) {
		fail('usage: node bin/smoke.ts <network> [--timeout <seconds>]');
	}
	if (networkText === undefined) {
		fail('usage: node bin/smoke.ts <network> [--timeout <seconds>]');
	}

	const network = decodeNetworkAlias(networkText);
	const expectedOutput = fs.readFileSync(path.join(root, 'dist', network, 'metadata.json'), 'utf8');

	const problems = await retryUntilClean({
		attempt: async (number) => {
			const found = await smokeOnce(network, expectedOutput);
			process.stdout.write(`attempt ${number}: ${found.length} problems\n`);
			return(found);
		},
		timeoutMs: timeoutSeconds * 1000,
		intervalMs: intervalSeconds * 1000
	});

	for (const problem of problems) {
		process.stderr.write(`problem: ${problem}\n`);
	}
	return(problems.length === 0);
}

let clean = false;
try {
	clean = await main();
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
if (clean) {
	process.exit(0);
}
process.exit(1);
