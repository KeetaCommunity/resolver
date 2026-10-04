// SPDX-License-Identifier: MPL-2.0
import type { ServiceMetadata } from '@keetanetwork/anchor/lib/resolver.js';
import type { AssertNever } from '@keetanetwork/anchor/lib/utils/never.js';
import { ToolError } from './errors.ts';

const knownServiceTypes = ['assetMovement', 'banking', 'cards', 'fx', 'kyc', 'notification', 'storage', 'username'] as const;
type ServiceType = typeof knownServiceTypes[number];

// The list above must match the SDK's service types in both directions.
type _ServiceTypesMatch = AssertNever<
	Exclude<ServiceType, keyof ServiceMetadata['services']> |
	Exclude<keyof ServiceMetadata['services'], ServiceType>
>;

type EntryKey = {
	kind: 'service';
	serviceType: ServiceType;
	serviceID: string;
} | {
	kind: 'currency';
	currencyCode: string;
};

function decodeServiceType(text: string): ServiceType | undefined {
	for (const serviceType of knownServiceTypes) {
		if (serviceType === text) {
			return(serviceType);
		}
	}

	return(undefined);
}

/*
 * Service keys are `<serviceType>/<serviceID>`, split on the first slash
 * because a serviceID may contain slashes. Anything else is a currency code.
 */
function encodeEntryKey(key: EntryKey): string {
	if (key.kind === 'currency') {
		if (key.currencyCode === '' || key.currencyCode.includes('/')) {
			throw(new ToolError('INVALID_ENTRY_KEY', `invalid currency code: ${key.currencyCode}`));
		}

		return(key.currencyCode);
	}

	if (key.serviceID === '') {
		throw(new ToolError('INVALID_ENTRY_KEY', `empty serviceID for ${key.serviceType}`));
	}

	return(`${key.serviceType}/${key.serviceID}`);
}

function decodeEntryKey(text: string): EntryKey {
	if (text === '') {
		throw(new ToolError('INVALID_ENTRY_KEY', 'empty entry key'));
	}

	const slash = text.indexOf('/');
	if (slash === -1) {
		return({ kind: 'currency', currencyCode: text });
	}

	const serviceType = decodeServiceType(text.slice(0, slash));
	if (serviceType === undefined) {
		throw(new ToolError('INVALID_ENTRY_KEY', `unknown service type in entry key: ${text}`));
	}

	const serviceID = text.slice(slash + 1);
	if (serviceID === '') {
		throw(new ToolError('INVALID_ENTRY_KEY', `empty serviceID in entry key: ${text}`));
	}

	return({ kind: 'service', serviceType, serviceID });
}

export { knownServiceTypes, encodeEntryKey, decodeEntryKey };
export type { ServiceType, EntryKey, _ServiceTypesMatch };
