// SPDX-License-Identifier: MPL-2.0

type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue };

/*
 * Serialized by hand: JSON.stringify lists integer-like keys first no matter
 * how the object was built, which would break the code unit ordering.
 */
function serialize(value: JSONValue, indent: string): string {
	if (value === null || typeof value !== 'object') {
		return(JSON.stringify(value));
	}

	const inner = indent + '  ';

	if (Array.isArray(value)) {
		if (value.length === 0) {
			return('[]');
		}
		const items = value.map((item) => {
			return(inner + serialize(item, inner));
		});
		return(`[\n${items.join(',\n')}\n${indent}]`);
	}

	const keys = Object.keys(value).sort();
	if (keys.length === 0) {
		return('{}');
	}
	const members = keys.map((key) => {
		const member = Object.getOwnPropertyDescriptor(value, key)?.value;
		return(`${inner}${JSON.stringify(key)}: ${serialize(member, inner)}`);
	});
	return(`{\n${members.join(',\n')}\n${indent}}`);
}

function canonicalJSON(value: JSONValue): string {
	return(serialize(value, '') + '\n');
}

function sameJSON(a: JSONValue, b: JSONValue): boolean {
	return(canonicalJSON(a) === canonicalJSON(b));
}

export { canonicalJSON, sameJSON };
export type { JSONValue };
