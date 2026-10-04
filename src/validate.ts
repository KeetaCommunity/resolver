// SPDX-License-Identifier: MPL-2.0
import * as KeetaNet from '@keetanetwork/keetanet-client';
import Resolver from '@keetanetwork/anchor/lib/resolver.js';
import { assertSignableServiceMetadataLegal, assertSignableServiceMetadataOperations } from '@keetanetwork/anchor/lib/resolver.generated.js';
import { verifyMetadataSignature } from '@keetanetwork/anchor/lib/anchor-metadata-server.js';
import type { SignableServiceMetadata } from '@keetanetwork/anchor/lib/anchor-metadata-server.js';
import { assertHTTPSignedField } from '@keetanetwork/anchor/lib/http-server/common.js';
import { ToolError } from './errors.ts';
import type { ResolverDocument } from './entries.ts';
import type { JSONValue } from './json.ts';

function describeError(error: unknown): string {
	if (error instanceof Error) {
		return(error.message);
	}
	return(String(error));
}

/*
 * Same rule as the SDK's `verifyServiceEntrySignature`, so a document that
 * passes here is not rejected by the resolver for its signatures. Anything
 * that makes the SDK reject the entry is a bad signature.
 */
async function entrySignatureIsValid(entry: { [key: string]: JSONValue }): Promise<boolean> {
	try {
		const accountText = entry['account'];
		if (typeof accountText !== 'string') {
			return(false);
		}
		const account = KeetaNet.lib.Account.fromPublicKeyString(accountText);
		const signed = assertHTTPSignedField(entry['signed']);
		const metadata: SignableServiceMetadata = {
			operations: assertSignableServiceMetadataOperations(entry['operations'])
		};

		const legal = entry['legal'];
		if (legal !== undefined && legal !== null) {
			metadata.legal = assertSignableServiceMetadataLegal(legal);
		}

		return(await verifyMetadataSignature(account, metadata, signed));
	} catch {
		return(false);
	}
}

/*
 * Signatures never expire (the SDK verifies them with `maxSkewMs: Infinity`),
 * so an entry copied verbatim from its source stays valid.
 */
async function validateDocument(document: ResolverDocument): Promise<void> {
	try {
		Resolver.Metadata.assertMetadata(document);
	} catch (error) {
		throw(new ToolError('VALIDATION', `schema: ${describeError(error)}`));
	}

	for (const [type, byID] of Object.entries(document.services)) {
		for (const [serviceID, entry] of Object.entries(byID)) {
			if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
				continue;
			}

			const hasAccount = entry['account'] !== undefined;
			const hasSigned = entry['signed'] !== undefined;
			if (!hasAccount && !hasSigned) {
				continue;
			}
			if (hasAccount !== hasSigned) {
				throw(new ToolError('VALIDATION', `unsigned field: ${type}/${serviceID}`));
			}
			if (!await entrySignatureIsValid(entry)) {
				throw(new ToolError('VALIDATION', `bad signature: ${type}/${serviceID}`));
			}
		}
	}
}

export { validateDocument };
