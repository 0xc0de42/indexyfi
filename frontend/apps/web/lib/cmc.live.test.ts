import {describe, expect, it} from 'vitest';
import {createCmcClient, lastDays} from './cmc-api';
import {REGISTRY_ASSETS} from '../data/registry.generated';

/**
 * CMC checks against a running backend (opt-in):
 *   INDEXFI_LIVE=1 INDEXFI_CMC_URL=http://127.0.0.1:8000 pnpm --filter @indexfi/web exec vitest run lib/cmc.live.test.ts
 * Asserts decoding of the full responses and canonical-id joins; it never claims coverage the server did not return.
 */
const live = process.env.INDEXFI_LIVE === '1';
const client = createCmcClient({baseUrl: process.env.INDEXFI_CMC_URL ?? process.env.INDEXFI_API_URL ?? 'http://127.0.0.1:8000'});
const registry = new Set(REGISTRY_ASSETS.map(a => a.id));

describe.skipIf(!live)('live CMC endpoints', () => {
  it('decodes every mapping and joins it to a registry asset', async () => {
    const r = await client.assets();
    if (!r.ok) throw Error(JSON.stringify(r.error));
    expect(r.value.length).toBeGreaterThan(0);
    for (const m of r.value) expect(registry.has(m.assetId), m.assetId).toBe(true);
  });
  it('decodes all quote rows (any mix of available / pending / error)', async () => {
    const r = await client.quotes();
    if (!r.ok) throw Error(JSON.stringify(r.error));
    for (const q of r.value) expect(registry.has(q.assetId)).toBe(true);
    console.info('quotes:', r.value.length, 'available:', r.value.filter(q => q.quote).length);
  });
  it('decodes 30-day daily history for all assets and an explicit multi-asset request', async () => {
    const all = await client.history({assetIds: [], ...lastDays(30)});
    if (!all.ok) throw Error(JSON.stringify(all.error));
    console.info('series:', all.value.series.length, 'points:', all.value.series.reduce((n, s) => n + s.points.length, 0));
    const two = all.value.series.slice(0, 2).map(s => s.assetId);
    const r = await client.history({assetIds: two, ...lastDays(7)});
    expect(r.ok && r.value.series.map(s => s.assetId).sort()).toEqual([...two].sort());
  });
  it('maps an unknown asset to a typed error', async () => {
    const r = await client.quotes(['56:0x0000000000000000000000000000000000000000']);
    expect(!r.ok && r.error.kind).toBe('unknown_asset');
  });
});
