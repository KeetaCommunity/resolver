// SPDX-License-Identifier: MPL-2.0
import type { Networks } from '@keetanetwork/keetanet-client/config/index.js';
import type { AssertNever } from '@keetanetwork/anchor/lib/utils/never.js';

const networkAliases = ['main', 'test'] as const;
type NetworkAlias = typeof networkAliases[number];

// Every alias must name a network that the KeetaNet client knows.
type _NetworksExist = AssertNever<Exclude<NetworkAlias, Networks>>;

function decodeNetworkAlias(text: string): NetworkAlias {
	for (const alias of networkAliases) {
		if (alias === text) {
			return(alias);
		}
	}

	throw(new Error(`unknown network: ${text}`));
}

export { networkAliases, decodeNetworkAlias };
export type { NetworkAlias, _NetworksExist };
