import type {Asset} from '@/domain/model';
import {REGISTRY_ASSETS} from '../data/registry.generated';
import {CATEGORY_OVERRIDES} from '../data/categories';

/**
 * Verified reference-asset registry (BNB Chain, chain 56), generated from the
 * backend's selected.json. Identity is the canonical "<chainId>:<lowercase address>"
 * ID; never look assets up by ticker. These are price references, not verified
 * chain-97 collateral.
 */
const palette = ['#d96c32', '#647b94', '#ac8a48', '#52857c', '#8c7baf', '#b66a7e'];

export const referenceAssets: readonly Asset[] = REGISTRY_ASSETS.map((asset, index) => ({
  ...asset,
  // OIK (a game token) and VAI (a stablecoin) are generated as "LST"; overrides correct those too.
  category: CATEGORY_OVERRIDES[asset.id] ?? (asset.category === 'LST' ? 'Crypto' : asset.category),
  color: palette[index % palette.length],
}));

const byId = new Map(referenceAssets.map(asset => [asset.id, asset]));

export function referenceAssetById(id: string): Asset | undefined {
  return byId.get(id.toLowerCase());
}

export const referenceCategories: readonly string[] = [...new Set(referenceAssets.map(asset => asset.category))].sort();

/** Verified chain-97 collateral. Empty until testnet contracts and routes are verified (Phase III). */
export const testnetCollateral: readonly Asset[] = [];
