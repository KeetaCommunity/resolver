// SPDX-License-Identifier: MPL-2.0
import type Resolver from '@keetanetwork/anchor/lib/resolver.js';
import { createFetchContext, resolveStrict } from './fetch.ts';
import { canonicalJSON } from './json.ts';
import type { JSONValue } from './json.ts';
import type { NetworkAlias } from './network.ts';

const publicBaseURL = 'https://resolver.xescu.re';

// Browser wallets read the document cross-origin, so they need this exact header.
const probeOrigin = 'https://example.org';

// The parts of the Resolver that compareRoot uses.
type RootReader = Pick<Resolver, 'getRootMetadata' | 'listTokens' | 'stats'>;

function describeError(error: unknown): string {
	if (error instanceof Error) {
		return(error.message);
	}
	return(String(error));
}

function checkHeaders(headers: Headers): string[] {
	const problems: string[] = [];

	if (headers.get('access-control-allow-origin') !== '*') {
		problems.push('missing header: access-control-allow-origin: *');
	}

	const contentType = headers.get('content-type');
	if (contentType === null) {
		problems.push('wrong content-type: (none)');
	} else if (!contentType.startsWith('application/json')) {
		problems.push(`wrong content-type: ${contentType}`);
	}

	return(problems);
}

function countCurrencyEntries(document: JSONValue): number {
	if (typeof document !== 'object' || document === null || Array.isArray(document)) {
		return(0);
	}
	const currencyMap = document.currencyMap;
	if (typeof currencyMap !== 'object' || currencyMap === null || Array.isArray(currencyMap)) {
		return(0);
	}
	return(Object.keys(currencyMap).length);
}

async function compareRoot(resolver: RootReader, expectedOutput: string): Promise<string[]> {
	let resolved: JSONValue;
	try {
		resolved = await resolveStrict(await resolver.getRootMetadata(), resolver);
	} catch (error) {
		return([`root metadata unresolved: ${describeError(error)}`]);
	}

	const problems: string[] = [];
	if (canonicalJSON(resolved) !== expectedOutput) {
		problems.push('root metadata differs from dist');
	}

	try {
		const tokens = await resolver.listTokens();
		const entries = countCurrencyEntries(resolved);
		if (tokens.length !== entries) {
			problems.push(`listTokens count ${tokens.length} != currency entries ${entries}`);
		}
	} catch (error) {
		problems.push(`listTokens failed: ${describeError(error)}`);
	}

	return(problems);
}

async function checkLiveResponse(network: NetworkAlias): Promise<string[]> {
	const url = `${publicBaseURL}/${network}/metadata.json`;
	try {
		const response = await fetch(url, { headers: { origin: probeOrigin }, signal: AbortSignal.timeout(20_000) });
		await response.body?.cancel();
		if (!response.ok) {
			return([`unexpected status: ${response.status}`]);
		}
		return(checkHeaders(response.headers));
	} catch (error) {
		return([`fetch failed: ${describeError(error)}`]);
	}
}

async function smokeOnce(network: NetworkAlias, expectedOutput: string): Promise<string[]> {
	const responseProblems = await checkLiveResponse(network);
	// A fresh context per attempt, so a failed read is never served from a cache.
	const rootProblems = await compareRoot(createFetchContext({ network }).resolver, expectedOutput);
	return([...responseProblems, ...rootProblems]);
}

type RetryOptions = {
	attempt: (number: number) => Promise<string[]>;
	timeoutMs: number;
	intervalMs: number;
};

async function sleep(milliseconds: number): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}

/*
 * GitHub Pages caches for 600 s, so a fresh deploy can take that long to show.
 * The last attempt lands on the deadline instead of overshooting it.
 */
async function retryUntilClean(options: RetryOptions): Promise<string[]> {
	const deadline = Date.now() + options.timeoutMs;

	for (let number = 1; ; number++) {
		const problems = await options.attempt(number);
		if (problems.length === 0) {
			return([]);
		}
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			return(problems);
		}
		await sleep(Math.min(options.intervalMs, remaining));
	}
}

export { checkHeaders, compareRoot, retryUntilClean, smokeOnce };
export type { RootReader };
