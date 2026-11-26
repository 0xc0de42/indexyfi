import {randomBytes} from 'node:crypto';
import {encodeAbiParameters, getAddress, isAddress, toHex, type Address} from 'viem';
import {mineFlapSalt} from '../flap';
import {executionAsset, type FlapManifest} from './flap-manifest';

export interface FlapPrepareInput {
  readonly chainId: number;
  readonly creator: string;
  readonly name: string;
  readonly symbol: string;
  readonly metadataURI: string;
  readonly constituents: readonly {readonly token: string; readonly weightBps: number}[];
  readonly seed: string;
  readonly liquidity: string;
}

export interface FlapPreparation {
  readonly requestId: string;
  readonly salt: `0x${string}`;
  readonly predictedToken: Address;
  readonly launchAuthorization: `0x${string}`;
  readonly feedIds: readonly number[];
  readonly expiresAt: string;
  readonly saltLockTransaction: null;
}

const uint = (value: string, field: string) => {
  if (!/^\d+$/.test(value)) throw Error(`${field} must be an unsigned integer string`);
  return BigInt(value);
};

export async function prepareFlapLaunch(input: FlapPrepareInput, manifest: FlapManifest): Promise<FlapPreparation> {
  if (input.chainId !== manifest.chainId) throw Error('chain does not match Flap deployment');
  if (!isAddress(input.creator)) throw Error('invalid creator');
  if (!input.name.trim() || input.name.length > 80 || !input.symbol.trim() || input.symbol.length > 16) throw Error('invalid token identity');
  if (input.constituents.length < 1 || input.constituents.length > 32) throw Error('Flap baskets require 1 to 32 constituents');
  const seen = new Set<string>();
  let weights = 0;
  const feedIds: number[] = [];
  for (const constituent of input.constituents) {
    if (!isAddress(constituent.token)) throw Error('invalid constituent token');
    const token = getAddress(constituent.token);
    const key = token.toLowerCase();
    if (seen.has(key)) throw Error('duplicate constituent token');
    seen.add(key);
    if (!Number.isInteger(constituent.weightBps) || constituent.weightBps <= 0) throw Error('invalid constituent weight');
    weights += constituent.weightBps;
    const admitted = executionAsset(manifest, token);
    if (!admitted) throw Error(`unsupported Flap asset ${token}`);
    feedIds.push(admitted.feedId);
  }
  if (weights !== 10_000) throw Error('constituent weights must total 10000 bps');
  if (uint(input.seed, 'seed') < BigInt(manifest.minimumSeed)) throw Error('seed is below the Flap minimum');
  if (uint(input.liquidity, 'liquidity') < BigInt(manifest.minimumLiquidity)) throw Error('liquidity is below the Flap minimum');

  const start = BigInt(`0x${randomBytes(32).toString('hex')}`);
  const mined = await mineFlapSalt({portal: manifest.portal, implementation: manifest.tokenImplementation, suffix: manifest.salt.suffix}, {start});
  let requestId = BigInt(`0x${randomBytes(32).toString('hex')}`);
  if (requestId === 0n) requestId = 1n;
  return {
    requestId: requestId.toString(),
    salt: mined.salt,
    predictedToken: mined.token,
    launchAuthorization: encodeAbiParameters([{type: 'bytes32'}], [mined.salt]),
    feedIds,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    saltLockTransaction: null,
  };
}
