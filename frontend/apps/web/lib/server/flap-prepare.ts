/**
 * Server-side Flap launch preparation: the only place a Flap launch salt is produced (POST /api/flap/launch/prepare).
 * Stateless and credential-free: it reads the public Flap manifest, validates the request, mines a CREATE2 salt whose
 * predicted token ends in the manifest suffix (…7777), checks that the address is still free on chain, and returns the
 * unsigned launchAuthorization (abi.encode(bytes32 salt)). No operator key, signature or salt lock is involved.
 *
 * Request  (JSON): FlapPrepareInput        — provider is optional but must be 'flap' when present.
 * Response (200) : FlapPreparation
 * Errors         : {error: FlapPrepareErrorCode, message}  — 400 for invalid input, 503 when Flap or salt mining is unavailable.
 */
import {randomBytes} from 'node:crypto';
import {createPublicClient, encodeAbiParameters, fallback, getAddress, http, isAddress, zeroAddress, type Address} from 'viem';
import {bscTestnet} from 'viem/chains';
import {mineFlapSalt} from '../flap';
import {BSC_TESTNET_RPCS} from '../vaults';
import {executionAsset, type FlapManifest} from './flap-manifest';

export interface FlapPrepareInput {
  readonly provider?: 'flap';
  readonly chainId: number;
  readonly creator: string;
  readonly name: string;
  readonly symbol: string;
  readonly metadataURI: string;
  readonly constituents: readonly {readonly token: string; readonly weightBps: number}[];
  /** Settlement base units, decimal string. */
  readonly seed: string;
  readonly liquidity: string;
}

export interface FlapPreparation {
  readonly provider: 'flap';
  readonly chainId: number;
  readonly requestId: string;
  readonly salt: `0x${string}`;
  readonly predictedToken: Address;
  /** abi.encode(bytes32 salt), passed to the factory as launchAuthorization. Not a signature. */
  readonly launchAuthorization: `0x${string}`;
  readonly feedIds: readonly number[];
  readonly expiresAt: string;
  /** Whether the predicted address was confirmed free on chain (false when no RPC answered; the launch itself is final). */
  readonly collisionChecked: boolean;
  readonly saltLockTransaction: null;
}

export type FlapPrepareErrorCode =
  | 'invalid_json' | 'invalid_request' | 'invalid_venue' | 'invalid_chain' | 'invalid_creator' | 'invalid_identity'
  | 'invalid_basket' | 'invalid_funding' | 'flap_unavailable' | 'salt_generation_failed';

export class FlapPrepareError extends Error {
  constructor(readonly code: FlapPrepareErrorCode, message: string) { super(message); }
  get status() { return this.code === 'flap_unavailable' || this.code === 'salt_generation_failed' ? 503 : 400; }
}
const fail = (code: FlapPrepareErrorCode, message: string): never => { throw new FlapPrepareError(code, message); };

export const SUPPORTED_FLAP_CHAINS = [97] as const;
const PREPARATION_TTL_MS = 10 * 60_000;
const MAX_COLLISION_RETRIES = 3;

/** Shape check of an untrusted JSON body; semantic checks against the manifest happen in prepareFlapLaunch. */
export function parseFlapPrepareInput(body: unknown): FlapPrepareInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('invalid_request', 'request body must be a JSON object');
  const b = body as Record<string, unknown>;
  if (b.provider !== undefined && b.provider !== 'flap') fail('invalid_venue', 'this route prepares Flap launches only');
  if (typeof b.chainId !== 'number' || !Number.isInteger(b.chainId)) fail('invalid_chain', 'chainId must be an integer');
  if (!(SUPPORTED_FLAP_CHAINS as readonly number[]).includes(b.chainId as number)) fail('invalid_chain', `unsupported Flap chain ${String(b.chainId)}`);
  for (const k of ['creator', 'name', 'symbol', 'metadataURI', 'seed', 'liquidity'] as const) {
    if (typeof b[k] !== 'string') fail(k === 'seed' || k === 'liquidity' ? 'invalid_funding' : k === 'creator' ? 'invalid_creator' : 'invalid_identity', `${k} must be a string`);
  }
  if (!Array.isArray(b.constituents)) fail('invalid_basket', 'constituents must be an array');
  const constituents = (b.constituents as unknown[]).map(c => {
    const x = c as Record<string, unknown> | null;
    if (!x || typeof x.token !== 'string' || typeof x.weightBps !== 'number') fail('invalid_basket', 'each constituent needs token and weightBps');
    return {token: x!.token as string, weightBps: x!.weightBps as number};
  });
  return {provider: 'flap', chainId: b.chainId as number, creator: b.creator as string, name: b.name as string, symbol: b.symbol as string,
    metadataURI: b.metadataURI as string, constituents, seed: b.seed as string, liquidity: b.liquidity as string};
}

const uint = (value: string, field: string) => (/^\d{1,78}$/.test(value) ? BigInt(value) : fail('invalid_funding', `${field} must be an unsigned integer string`));

export interface PrepareDeps {
  /** Contract code at an address; undefined/'0x' means free. Throwing means "could not check". */
  readonly getCode?: (address: Address) => Promise<string | undefined>;
  readonly mine?: typeof mineFlapSalt;
  readonly now?: () => number;
}

const defaultClient = () => createPublicClient({chain: bscTestnet, transport: fallback(BSC_TESTNET_RPCS.map(url => http(url, {timeout: 4_000})))});

export async function prepareFlapLaunch(input: FlapPrepareInput, manifest: FlapManifest, deps: PrepareDeps = {}): Promise<FlapPreparation> {
  if (input.provider !== undefined && input.provider !== 'flap') fail('invalid_venue', 'this route prepares Flap launches only');
  if (input.chainId !== manifest.chainId) fail('invalid_chain', 'chain does not match Flap deployment');
  if (!isAddress(input.creator) || getAddress(input.creator) === zeroAddress) fail('invalid_creator', 'invalid creator');
  if (!input.name.trim() || input.name.length > 80 || !input.symbol.trim() || input.symbol.length > 16 || input.metadataURI.length > 512) fail('invalid_identity', 'invalid token identity');
  if (input.constituents.length < 1 || input.constituents.length > 32) fail('invalid_basket', 'Flap baskets require 1 to 32 constituents');
  const seen = new Set<string>();
  let weights = 0;
  const feedIds: number[] = [];
  for (const constituent of input.constituents) {
    if (!isAddress(constituent.token)) fail('invalid_basket', 'invalid constituent token');
    const token = getAddress(constituent.token);
    if (seen.has(token)) fail('invalid_basket', 'duplicate constituent token');
    seen.add(token);
    if (!Number.isInteger(constituent.weightBps) || constituent.weightBps <= 0) fail('invalid_basket', 'invalid constituent weight');
    weights += constituent.weightBps;
    const admitted = executionAsset(manifest, token);
    if (!admitted) fail('invalid_basket', `unsupported Flap asset ${token}`);
    feedIds.push(admitted!.feedId);
  }
  if (weights !== 10_000) fail('invalid_basket', 'constituent weights must total 10000 bps');
  if (uint(input.seed, 'seed') < BigInt(manifest.minimumSeed)) fail('invalid_funding', 'seed is below the Flap minimum');
  if (uint(input.liquidity, 'liquidity') < BigInt(manifest.minimumLiquidity)) fail('invalid_funding', 'liquidity is below the Flap minimum');

  // Mine, then confirm the predicted …7777 address is still free; on a collision continue from the next salt.
  const mine = deps.mine ?? mineFlapSalt;
  const getCode = deps.getCode ?? ((client => (address: Address) => client.getCode({address}))(defaultClient()));
  let start = BigInt(`0x${randomBytes(32).toString('hex')}`);
  let mined: Awaited<ReturnType<typeof mineFlapSalt>> | null = null, collisionChecked = false;
  for (let attempt = 0; attempt <= MAX_COLLISION_RETRIES && !mined; attempt++) {
    let candidate: Awaited<ReturnType<typeof mineFlapSalt>>;
    try {
      candidate = await mine({portal: manifest.portal, implementation: manifest.tokenImplementation, suffix: manifest.salt.suffix}, {start});
    } catch (error) {
      return fail('salt_generation_failed', error instanceof Error ? error.message : 'salt mining failed');
    }
    let code: string | undefined;
    try { code = await getCode(candidate.token); collisionChecked = true; } catch { collisionChecked = false; mined = candidate; break; }
    if (!code || code === '0x') mined = candidate;
    else start = BigInt(candidate.salt) + 1n;
  }
  if (!mined) fail('salt_generation_failed', `predicted token addresses were taken ${MAX_COLLISION_RETRIES + 1} times`);
  let requestId = BigInt(`0x${randomBytes(32).toString('hex')}`);
  if (requestId === 0n) requestId = 1n;
  return {
    provider: 'flap',
    chainId: manifest.chainId,
    requestId: requestId.toString(),
    salt: mined!.salt,
    predictedToken: mined!.token,
    launchAuthorization: encodeAbiParameters([{type: 'bytes32'}], [mined!.salt]),
    feedIds,
    expiresAt: new Date((deps.now ?? Date.now)() + PREPARATION_TTL_MS).toISOString(),
    collisionChecked,
    saltLockTransaction: null,
  };
}
