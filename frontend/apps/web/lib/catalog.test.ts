import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {catalogAssetById, catalogAssetBySymbol, catalogAssets, catalogFeedIds, feedIdByAssetId} from './catalog';

const publicDir = join(__dirname, '..', 'public');

describe('common-asset catalog', () => {
  it('maps every asset to exactly one Atlas feed', () => {
    expect(catalogAssets.length).toBeGreaterThan(0);
    for (const asset of catalogAssets) expect(feedIdByAssetId[asset.id]).toBe(asset.feedId);
    expect(new Set(catalogAssets.map(asset => asset.feedId))).toEqual(new Set(catalogFeedIds));
    expect(Object.keys(feedIdByAssetId)).toHaveLength(catalogAssets.length);
  });

  it('serves a logo for every asset from public/', () => {
    const missing = catalogAssets.filter(asset => !existsSync(join(publicDir, asset.logoPath!)));
    expect(missing.map(asset => asset.symbol)).toEqual([]);
  });

  it('carries no provider URLs; prices come from the price server', () => {
    for (const asset of catalogAssets) {
      expect(JSON.stringify(asset.catalog)).not.toMatch(/https?:\/\//);
      expect(asset.price).toBeNull();
    }
  });

  it('looks assets up by ID and symbol', () => {
    const usdt = catalogAssetBySymbol('usdt');
    expect(usdt?.feedId).toBe(647);
    expect(usdt?.feedRule).toBe('explicit_override');
    expect(catalogAssetById(usdt!.id.toUpperCase())?.symbol).toBe('USDT');
    expect(catalogAssetBySymbol('NOT-A-TOKEN')).toBeUndefined();
  });
});
