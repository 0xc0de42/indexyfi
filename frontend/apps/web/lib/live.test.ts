import {describe, expect, it} from 'vitest';
import {createApiClient, MAX_HISTORY_MS} from './api';
import {REGISTRY_ASSETS} from '../data/registry.generated';

/**
 * Integration checks against a running backend (and optionally the Next.js proxy).
 *   INDEXFI_LIVE=1 INDEXFI_API_URL=http://127.0.0.1:8000 [INDEXFI_PROXY_URL=http://127.0.0.1:3000/backend] pnpm test:live
 * Skipped unless INDEXFI_LIVE=1.
 */
const live = process.env.INDEXFI_LIVE === '1';
const direct = process.env.INDEXFI_API_URL ?? 'http://127.0.0.1:8000';
const proxy = process.env.INDEXFI_PROXY_URL;
const BTCB = '56:0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c';
const ETH = '56:0x2170ed0880ac9a755fd29b2688956bd959f933f8';

const targets: [string, string][] = [['direct', direct], ...(proxy ? ([['proxy', proxy]] as [string, string][]) : [])];

describe.skipIf(!live).each(targets)('live backend (%s)', (_name, baseUrl) => {
  const client = createApiClient({baseUrl});

  it('serves a snapshot with exactly the verified registry', async () => {
    const result = await client.snapshot();
    if (!result.ok) throw Error(`snapshot failed: ${JSON.stringify(result.error)}`);
    const registry = new Map(REGISTRY_ASSETS.map(a => [a.id, a.feedId]));
    const ids = result.value.prices.map(p => p.assetId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(new Set(registry.keys()));
    for (const price of result.value.prices) {
      expect(price.feedId).toBe(registry.get(price.assetId));
      expect(price.price).toMatch(/^\d+(\.\d+)?$/);
    }
    expect(Number.isFinite(result.value.snapshotAtMs)).toBe(true);
  });

  it('advances the snapshot roughly once per second', async () => {
    const first = await client.snapshot();
    await new Promise(resolve => setTimeout(resolve, 2_200));
    const second = await client.snapshot();
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(second.value.snapshotAtMs).toBeGreaterThan(first.value.snapshotAtMs);
  });

  it('returns filtered, chronological minute closes', async () => {
    const end = new Date();
    const result = await client.history({start: new Date(end.getTime() - 60 * 60_000), end, assetIds: [BTCB, ETH]});
    if (!result.ok) throw Error(`history failed: ${JSON.stringify(result.error)}`);
    const times = result.value.map(s => s.snapshotAtMs);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    for (const snapshot of result.value) for (const price of snapshot.prices) expect([BTCB, ETH]).toContain(price.assetId);
    console.info(`history(1h, BTCB+ETH): ${result.value.length} minute closes`);
  });

  it('returns an empty array for unknown assets', async () => {
    const end = new Date();
    const result = await client.history({start: new Date(end.getTime() - 60 * 60_000), end, assetIds: ['56:0x0000000000000000000000000000000000000000']});
    expect(result).toEqual({ok: true, value: []});
  });

  it('accepts exactly 24 hours', async () => {
    const end = new Date();
    const result = await client.history({start: new Date(end.getTime() - MAX_HISTORY_MS), end, assetIds: [BTCB]});
    expect(result.ok).toBe(true);
  });

  it('answers 400 invalid_time_range for start >= end and naive timestamps', async () => {
    for (const query of ['start=2026-11-25T18:00:00Z&end=2026-11-25T17:00:00Z', 'start=2026-11-25T17:00:00&end=2026-11-25T18:00:00']) {
      const response = await fetch(`${baseUrl}/history?${query}`, {cache: 'no-store'});
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({error: 'invalid_time_range'});
    }
  });

  it('rejects ranges over 24 hours at the server boundary', async () => {
    const end = new Date();
    const start = new Date(end.getTime() - MAX_HISTORY_MS - 60_000);
    const response = await fetch(`${baseUrl}/history?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}&asset_id=${BTCB}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({error: "invalid_time_range"});
  });
});

describe.skipIf(!live)('CORS on the direct backend', () => {
  it.each(['http://localhost:3000', 'http://127.0.0.1:3000'])('origin %s', async origin => {
    const response = await fetch(`${direct}/snapshot`, {headers: {Origin: origin}});
    console.info(`Origin ${origin} -> Access-Control-Allow-Origin: ${response.headers.get('access-control-allow-origin')}`);
    expect(response.status).toBe(200);
  });
});
