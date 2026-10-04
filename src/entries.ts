// SPDX-License-Identifier: MPL-2.0
import type { ServiceMetadata } from '@keetanetwork/anchor/lib/resolver.js';
import type { AssertNever } from '@keetanetwork/anchor/lib/utils/never.js';
import { ToolError } from './errors.ts';
import type { JSONValue } from './json.ts';

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

type JSONObject = { [key: string]: JSONValue };

// The key is the encoded entry key.
type EntryMap = Map<string, JSONValue>;

type ResolverDocument = {
	version: 1;
	currencyMap: JSONObject;
	services: { [type: string]: JSONObject };
};

function isObject(value: JSONValue | undefined): value is JSONObject {
	return(typeof value === 'object' && value !== null && !Array.isArray(value));
}

function isServiceType(text: string): text is ServiceType {
	return(knownServiceTypes.some((serviceType) => {
		return(serviceType === text);
	}));
}

// Defined instead of assigned, so a key of `__proto__` stays an own property.
function setMember<T>(target: { [key: string]: T }, key: string, value: T): void {
	Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/*
 * Reads a resolver document into one entry per currency code and per service.
 * Whatever the tool does not manage is dropped with a warning.
 */
function flatten(document: JSONValue): { entries: EntryMap; warnings: string[] } {
	if (!isObject(document)) {
		throw(new ToolError('INVALID_DOCUMENT', 'document is not an object'));
	}
	if (document.version !== 1) {
		throw(new ToolError('INVALID_DOCUMENT', 'version is not 1'));
	}

	const currencyMap = document.currencyMap ?? {};
	if (!isObject(currencyMap)) {
		throw(new ToolError('INVALID_DOCUMENT', 'currencyMap is not an object'));
	}
	const services = document.services ?? {};
	if (!isObject(services)) {
		throw(new ToolError('INVALID_DOCUMENT', 'services is not an object'));
	}

	const entries: EntryMap = new Map();
	const warnings: string[] = [];

	for (const key of Object.keys(document)) {
		if (key !== 'version' && key !== 'currencyMap' && key !== 'services') {
			warnings.push(`dropped key: ${key}`);
		}
	}

	for (const [currencyCode, value] of Object.entries(currencyMap)) {
		if (currencyCode.includes('/')) {
			warnings.push(`dropped currency code: ${currencyCode}`);
			continue;
		}
		entries.set(encodeEntryKey({ kind: 'currency', currencyCode }), value);
	}

	for (const [type, byID] of Object.entries(services)) {
		if (!isObject(byID)) {
			throw(new ToolError('INVALID_DOCUMENT', `services.${type} is not an object`));
		}
		if (!isServiceType(type)) {
			warnings.push(`dropped service type: ${type}`);
			continue;
		}
		for (const [serviceID, value] of Object.entries(byID)) {
			entries.set(encodeEntryKey({ kind: 'service', serviceType: type, serviceID }), value);
		}
	}

	return({ entries, warnings });
}

function unflatten(entries: EntryMap): ResolverDocument {
	const document: ResolverDocument = { version: 1, currencyMap: {}, services: {} };

	for (const [text, value] of entries) {
		const key = decodeEntryKey(text);
		if (key.kind === 'currency') {
			setMember(document.currencyMap, key.currencyCode, value);
			continue;
		}
		let byID = document.services[key.serviceType];
		if (byID === undefined) {
			byID = {};
			document.services[key.serviceType] = byID;
		}
		setMember(byID, key.serviceID, value);
	}

	return(document);
}

export { knownServiceTypes, encodeEntryKey, decodeEntryKey, flatten, unflatten };
export type { ServiceType, EntryKey, EntryMap, ResolverDocument, _ServiceTypesMatch };
