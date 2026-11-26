/**
 * Flap direct launches (contracts/openfour/contracts/flap, docs/flap/FORK_ACCEPTANCE.md).
 *
 * The Flap Portal deploys the portfolio token with CREATE2 as an EIP-1167 clone of Flap's token implementation and only
 * accepts salts whose resulting address ends in the vanity suffix ("7777" on chain 97; a random salt reverts). The
 * IndexFi Flap factory takes `launchAuthorization = abi.encode(bytes32 salt)` — no operator signature, no salt lock, no
 * native fee. Mining needs no secret, so it runs in the browser (~65k hashes for a 4-hex suffix).
 */
import {encodeAbiParameters, getContractAddress, keccak256, toHex, type Address, type Hex} from 'viem';

export const cloneInitCode = (implementation: Address): Hex =>
  `0x3d602d80600a3d3981f3363d3d373d3d3d363d73${implementation.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3`;

/** Address the Portal will deploy the token at for this salt. */
export function predictFlapToken(portal: Address, implementation: Address, salt: Hex): Address {
  return getContractAddress({opcode: 'CREATE2', from: portal, salt, bytecodeHash: keccak256(cloneInitCode(implementation))});
}

export interface MinedSalt {
  readonly salt: Hex;
  readonly token: Address;
  readonly tries: number;
}

/**
 * Find a salt whose predicted token address ends in `suffix` (hex, case-insensitive). Searches from a random 256-bit
 * start so concurrent creators do not collide, yielding to the event loop between chunks to keep the page responsive.
 */
export async function mineFlapSalt(
  {portal, implementation, suffix}: {portal: Address; implementation: Address; suffix: string},
  {maxTries = 5_000_000, chunk = 4_096, signal, start}: {maxTries?: number; chunk?: number; signal?: AbortSignal; start?: bigint} = {},
): Promise<MinedSalt> {
  const want = suffix.toLowerCase();
  if (!/^[0-9a-f]{1,8}$/.test(want)) throw Error('Invalid vanity suffix');
  const bytecodeHash = keccak256(cloneInitCode(implementation));
  let n = start ?? BigInt(toHex(crypto.getRandomValues(new Uint8Array(32))));
  for (let tries = 0; tries < maxTries; ) {
    if (signal?.aborted) throw Error('Salt search cancelled');
    for (let i = 0; i < chunk && tries < maxTries; i++, tries++, n = (n + 1n) % 2n ** 256n) {
      const salt = toHex(n, {size: 32});
      const token = getContractAddress({opcode: 'CREATE2', from: portal, salt, bytecodeHash});
      if (token.toLowerCase().endsWith(want)) return {salt, token, tries: tries + 1};
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw Error(`No salt found for suffix ${suffix} within ${maxTries} tries`);
}

/** The factory's launch authorization for Flap: the ABI-encoded salt (not an OpenFour signature). */
export const flapAuthorization = (salt: Hex): Hex => encodeAbiParameters([{type: 'bytes32'}], [salt]);

export const taxLabel = (bps: number) => `${(bps / 100).toLocaleString('en-US', {maximumFractionDigits: 2})}%`;
export function taxSummary(t: {buyTaxBps: number; sellTaxBps: number; taxDurationSeconds: number}): string {
  const duration = t.taxDurationSeconds < 120 ? `${t.taxDurationSeconds} s` : t.taxDurationSeconds < 7_200 ? `${Math.round(t.taxDurationSeconds / 60)} min` : `${(t.taxDurationSeconds / 86_400).toFixed(1)} days`;
  return `Buy ${taxLabel(t.buyTaxBps)} · sell ${taxLabel(t.sellTaxBps)} for ${duration} after launch, then 0%`;
}

/**
 * Readable messages for Flap launch and vault failures (selectors of the custom errors in contracts/openfour/contracts/flap,
 * plus the Portal's vanity-address check observed on the chain-97 fork). Unknown messages pass through unchanged.
 */
const FLAP_ERRORS: readonly [RegExp, string][] = [
  [/0xca4c5b2d/i, 'The Flap Portal rejected the token address (it must end in 7777). Prepare the launch again.'],
  [/Flap: factory configuration/, 'The Flap Portal has not enabled this IndexFi factory yet.'],
  [/0x41abc801|InvalidRequest/, 'This launch request was already used. Prepare the launch again.'],
  [/0x2084e5f6|InvalidPrices/, 'The signed Atlas prices were rejected (malformed or too many payloads). Try again.'],
  [/0x7dd37f70|Slippage/, 'Prices moved beyond the slippage limit, or a pool is more than 5% away from the Atlas price. Try again with fresh prices.'],
  [/0x8b2024a5|InsufficientInventory/, 'The vault has too little unissued inventory for this deposit.'],
  [/0x2e8acb0d|Inactive/, 'This vault is not active.'],
  [/0x6de3e846|InvalidLaunch/, 'The launch parameters were rejected by the Flap vault.'],
];
export function flapErrorMessage(message: string): string {
  return FLAP_ERRORS.find(([pattern]) => pattern.test(message))?.[1] ?? message;
}
