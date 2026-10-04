// SPDX-License-Identifier: MPL-2.0

type ToolErrorCode =
	'INVALID_ENTRY_KEY' |
	'INVALID_DOCUMENT' |
	'INVALID_SOURCES' |
	'INVALID_SNAPSHOT' |
	'SNAPSHOT_MISSING' |
	'SNAPSHOT_ORPHAN' |
	'SNAPSHOT_MISMATCH' |
	'RULE_TARGET_MISSING' |
	'RENAME_COLLISION' |
	'CONFLICT' |
	'VALIDATION' |
	'FETCH';

/*
 * A brand instead of `instanceof`, so the check still holds if two copies of
 * this module are loaded.
 */
const brand: unique symbol = Symbol('ToolError');

class ToolError extends Error {
	readonly code: ToolErrorCode;
	readonly [brand] = true;

	constructor(code: ToolErrorCode, message: string) {
		super(message);
		this.name = 'ToolError';
		this.code = code;
	}

	static isInstance(value: unknown): value is ToolError {
		return(typeof value === 'object' && value !== null && brand in value);
	}
}

export { ToolError };
export type { ToolErrorCode };
