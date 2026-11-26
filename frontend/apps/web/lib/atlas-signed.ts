/**
 * Atlas signed prices for on-chain injection (createVaultWithPrices / depositWithPrices / redeemWithPrices).
 *
 * Browser-safe helpers only (no provider URL, no credentials). The browser asks this app's server route
 * (app/api/atlas/signed -> lib/server/atlas-pull.ts) for signed payloads; the contracts verify the provider's
 * ECDSA signature over keccak256(payload) themselves (AtlasSignedOracle), so a payload cannot be forged on the way.
 *
 * Payload format: N records of 20 bytes (feedId uint32 | price uint80, 18 decimals | timestamp uint48 seconds),
 * then one count byte. One request covers at most 20 feeds.
 */
import {hexToBytes, type Hex} from 'viem';
import {REGISTRY_ASSETS} from '../data/registry.generated';

export const FEEDS_PER_PAYLOAD = 20;
/** Matches the validator's 32-asset basket limit (two payloads). */
export const MAX_FEEDS = 32;

export type SignedPrices = {readonly payloads: readonly Hex[]; readonly signatures: readonly Hex[]};
export type AtlasRecord = {readonly feedId: number; readonly price18: bigint; readonly timestamp: number};
export const NO_PRICES: SignedPrices = {payloads: [], signatures: []};

const REGISTRY_FEEDS: ReadonlySet<number> = new Set(REGISTRY_ASSETS.map(asset => asset.feedId));

/** Parses "751,632,956": positive integers, no duplicates, at most MAX_FEEDS, each a registry feed. */
export function parseFeedIds(raw: string | null, allowed: ReadonlySet<number> = REGISTRY_FEEDS): number[] {
  if (!raw) throw Error('feeds is required');
  const parts = raw.split(',').map(part => part.trim());
  if (parts.some(part => !/^[1-9][0-9]{0,9}$/.test(part))) throw Error('feeds must be positive integers');
  const ids = parts.map(Number);
  if (new Set(ids).size !== ids.length) throw Error('feeds must not repeat');
  if (ids.length > MAX_FEEDS) throw Error(`at most ${MAX_FEEDS} feeds`);
  const unknown = ids.filter(id => !allowed.has(id));
  if (unknown.length) throw Error(`unknown feeds: ${unknown.join(',')}`);
  return ids;
}

/** Decodes an Atlas payload exactly as the oracle contract does. */
export function decodeAtlasPayload(payload: Hex): AtlasRecord[] {
  const bytes = hexToBytes(payload);
  const count = bytes.length ? bytes[bytes.length - 1] : 0;
  if (!count || bytes.length !== count * 20 + 1) throw Error('Malformed Atlas payload');
  const read = (from: number, to: number) => bytes.slice(from, to).reduce((acc, b) => (acc << 8n) | BigInt(b), 0n);
  return Array.from({length: count}, (_, i) => {
    const o = i * 20;
    return {feedId: Number(read(o, o + 4)), price18: read(o + 4, o + 14), timestamp: Number(read(o + 14, o + 20))};
  });
}

/** Latest price per feed across payloads. */
export function pricesByFeed(prices: SignedPrices): Map<number, AtlasRecord> {
  const out = new Map<number, AtlasRecord>();
  for (const payload of prices.payloads) for (const r of decodeAtlasPayload(payload)) {
    const prev = out.get(r.feedId);
    if (!prev || r.timestamp > prev.timestamp) out.set(r.feedId, r);
  }
  return out;
}
