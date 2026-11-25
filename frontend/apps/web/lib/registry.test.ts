import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {REGISTRY_ASSETS} from '../data/registry.generated';
import {referenceAssetById, referenceAssets} from './catalog';
import {portfolios} from '../domain/fixtures';

const web = join(__dirname, '..');
const selectedPath = join(web, '../../../backend/registry/selected.json');

interface SelectedRecord {
  asset_id: string;
  symbol: string;
  feed_id: number;
  channel: string;
}

describe('verified registry', () => {
  it('matches the backend selection exactly (IDs, feeds, channels)', () => {
    expect(existsSync(selectedPath), `backend selection not found at ${selectedPath}`).toBe(true);
    const selected = JSON.parse(readFileSync(selectedPath, 'utf8')) as {verified: boolean; assets: SelectedRecord[]};
    expect(selected.verified).toBe(true);
    const backend = new Map(selected.assets.map(a => [a.asset_id, a]));
    expect(REGISTRY_ASSETS).toHaveLength(backend.size);
    for (const asset of REGISTRY_ASSETS) {
      const record = backend.get(asset.id);
      expect(record, asset.id).toBeDefined();
      expect(asset.feedId).toBe(record!.feed_id);
      expect(asset.channel).toBe(record!.channel);
      expect(asset.symbol).toBe(record!.symbol);
    }
  });

  it('is current with the generator', () => {
    expect(() => execFileSync(process.execPath, [join(web, 'scripts/generate-registry.mjs'), '--check'], {stdio: 'pipe'})).not.toThrow();
  });

  it('has 66 unique canonical chain-56 IDs and feeds, no USDC', () => {
    expect(REGISTRY_ASSETS).toHaveLength(66);
    expect(new Set(REGISTRY_ASSETS.map(a => a.id)).size).toBe(66);
    expect(new Set(REGISTRY_ASSETS.map(a => a.feedId)).size).toBe(66);
    for (const asset of REGISTRY_ASSETS) {
      expect(asset.id).toMatch(/^56:0x[0-9a-f]{40}$/);
      expect(asset.id).toBe(`56:${asset.address.toLowerCase()}`);
      expect(asset.chainId).toBe(56);
    }
    expect(REGISTRY_ASSETS.some(a => a.symbol.toUpperCase() === 'USDC' || a.feedId === 650)).toBe(false);
    expect(referenceAssetById('56:0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d')).toBeUndefined();
  });

  it('serves a logo for every asset and carries no provider URLs', () => {
    for (const asset of referenceAssets) {
      expect(existsSync(join(web, 'public', asset.logoPath)), asset.symbol).toBe(true);
      expect(JSON.stringify(asset)).not.toMatch(/https?:\/\//);
    }
  });

  it('looks up by canonical ID only and rejects unknown assets', () => {
    expect(referenceAssetById('56:0x7130D2A12B9BCBFAE4F2634D864A1EE1CE3EAD9C')?.symbol).toBe('BTCB');
    expect(referenceAssetById('BTCB')).toBeUndefined();
    expect(referenceAssetById('56:0x0000000000000000000000000000000000000000')).toBeUndefined();
  });

  it('builds fixture portfolios only from registry assets', () => {
    for (const p of portfolios) {
      expect(p.source).toBe('fixture');
      for (const a of p.allocations) expect(referenceAssetById(a.asset.id)).toBe(a.asset);
    }
  });
});
