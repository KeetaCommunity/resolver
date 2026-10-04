// SPDX-License-Identifier: MPL-2.0
import { test, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import Resolver from '@keetanetwork/anchor/lib/resolver.js';
import { flatten } from '../src/entries.ts';
import { createFetchContext, fetchSource, resolveStrict } from '../src/fetch.ts';
import type { FetchContext } from '../src/fetch.ts';
import { ToolError } from '../src/errors.ts';
import type { JSONValue } from '../src/json.ts';

const externalKey = '2b828e33-2692-46e9-817e-9b93d63f28fd';
const murphyAccount = 'keeta_athqkb6yw6h2e436xxaakuy4bctrqkqfctvy5xsp3ugvb3avv56zruxjcxauq';
const pfpAccount = 'keeta_aabdoyva5z5wpnx6a7ebgpwzopbipsbzhuyp5opoj2xro2vska6jjxqip5u62wa';
const tokenAccount = 'keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg';

function readFixture(name: string): JSONValue {
	return(JSON.parse(fs.readFileSync(new URL(`./fixtures/sources/${name}.json`, import.meta.url), 'utf8')));
}

function isFetchError(error: unknown): boolean {
	return(ToolError.isInstance(error) && error.code === 'FETCH');
}

const murphy = readFixture('murphy');
const pfp = readFixture('pfp');
if (typeof pfp !== 'object' || pfp === null || Array.isArray(pfp)) {
	throw(new Error('pfp fixture is not an object'));
}

// Account public key string to the document stored in that account's metadata.
const accounts = new Map<string, JSONValue>();
const stub = {
	getAccountInfo: async (account: { publicKeyString: { toString(): string } }) => {
		const document = accounts.get(account.publicKeyString.toString());
		if (document === undefined) {
			return({ info: { metadata: '' } });
		}
		return({ info: { metadata: Resolver.Metadata.formatMetadata(document) } });
	}
};

let server: http.Server;
let baseURL = '';
let context: FetchContext;

function reference(path: string): JSONValue {
	return({ external: externalKey, url: `${baseURL}${path}` });
}

before(async () => {
	server = http.createServer((request, response) => {
		const routes = new Map<string, () => void>([
			['/pfp/currencyMap', () => {
				response.setHeader('content-type', 'application/json');
				response.end(JSON.stringify(pfp['currencyMap']));
			}],
			['/pfp/services', () => {
				response.setHeader('content-type', 'application/json');
				response.end(JSON.stringify(pfp['services']));
			}],
			['/murphy', () => {
				response.setHeader('content-type', 'application/json');
				response.end(JSON.stringify(murphy));
			}],
			['/token', () => {
				response.setHeader('content-type', 'application/json');
				response.end(JSON.stringify(tokenAccount));
			}],
			['/500', () => {
				response.statusCode = 500;
				response.end('boom');
			}],
			['/html', () => {
				response.setHeader('content-type', 'text/html');
				response.end('<html>');
			}]
		]);
		const route = routes.get(request.url ?? '');
		if (route === undefined) {
			response.statusCode = 404;
			response.end('missing');
			return;
		}
		route();
	});
	await new Promise<void>((resolve) => {
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address() as AddressInfo;
	baseURL = `http://127.0.0.1:${address.port}`;
	context = createFetchContext({ client: stub, allowInsecureProtocols: true });

	accounts.set(murphyAccount, murphy);
	accounts.set(pfpAccount, {
		version: 1,
		currencyMap: reference('/pfp/currencyMap'),
		services: reference('/pfp/services')
	});
});

after(async () => {
	await new Promise<void>((resolve, reject) => {
		server.close((error) => {
			if (error === undefined) {
				resolve();
				return;
			}
			reject(error);
		});
		server.closeAllConnections();
	});
});

test('a keetanet source gives the entries of the resolved document', async () => {
	const result = await fetchSource(`keetanet://${murphyAccount}/metadata`, context);
	assert.deepEqual(result, flatten(murphy));
});

test('a source with nested HTTP references resolves fully', async () => {
	const result = await fetchSource(`keetanet://${pfpAccount}/metadata`, context);
	assert.deepEqual(result, flatten(pfp));
});

test('an HTTP source URL is read directly', async () => {
	const result = await fetchSource(`${baseURL}/murphy`, context);
	assert.deepEqual(result, flatten(murphy));
});

test('a one-key reference resolves to its string', async () => {
	const account = 'keeta_amkizw23ydxgyci66vmckzj3fffg3nkoh5pql2i3neywwwrx62dks4vfm2ui2';
	accounts.set(account, { version: 1, currencyMap: { $X: reference('/token') } });
	const result = await fetchSource(`keetanet://${account}/metadata`, context);
	assert.deepEqual(result, flatten({ version: 1, currencyMap: { $X: tokenAccount } }));
});

test('a reference to HTTP 500 throws FETCH', async () => {
	const account = 'keeta_amob7pxzhexqych4g56bmmtovdgwr6kljloyzkyb34k37jntj24doaqfbx4xk';
	accounts.set(account, { version: 1, currencyMap: reference('/500') });
	await assert.rejects(fetchSource(`keetanet://${account}/metadata`, context), isFetchError);
});

test('a reference to HTML content throws FETCH', async () => {
	const account = 'keeta_amrsj32dnrdwdupnkyl2mdkqopwax6eowmokdses6yx6tzyvsm2m2wtgrs4aa';
	accounts.set(account, { version: 1, currencyMap: reference('/html') });
	await assert.rejects(fetchSource(`keetanet://${account}/metadata`, context), isFetchError);
});

test('a reference to an unknown path throws FETCH', async () => {
	const account = 'keeta_annv7r4k3hjijskv536nwczrxdozdtmx4xktjnvg5ygakzjelfsx5svqwdk46';
	accounts.set(account, { version: 1, currencyMap: reference('/nowhere') });
	await assert.rejects(fetchSource(`keetanet://${account}/metadata`, context), isFetchError);
});

test('a self-referencing account throws FETCH', async () => {
	const account = 'keeta_apqpm6nbbfsdcmlpcpahkut27afguyo2hfdrtixighga7fln7ua657js4mweg';
	accounts.set(account, {
		version: 1,
		currencyMap: { external: externalKey, url: `keetanet://${account}/metadata` }
	});
	await assert.rejects(fetchSource(`keetanet://${account}/metadata`, context), isFetchError);
});

test('empty account metadata throws FETCH', async () => {
	await assert.rejects(fetchSource(`keetanet://${tokenAccount}/metadata`, context), isFetchError);
	await assert.rejects(fetchSource('keetanet://garbage/metadata', context), isFetchError);
});

test('a keetanet path other than /metadata throws FETCH', async () => {
	await assert.rejects(fetchSource(`keetanet://${murphyAccount}/other`, context), isFetchError);
});

test('an unsupported protocol throws FETCH', async () => {
	await assert.rejects(fetchSource('ftp://example.com/x', context), isFetchError);
});

test('resolveStrict rejects null anywhere', async () => {
	await assert.rejects(resolveStrict({ a: [1, null] }), isFetchError);
	await assert.rejects(resolveStrict(null), isFetchError);
});

test('resolveStrict passes plain JSON through', async () => {
	const value: JSONValue = { a: [1, 'b', true], c: { d: 'e' } };
	assert.deepEqual(await resolveStrict(value), value);
});
