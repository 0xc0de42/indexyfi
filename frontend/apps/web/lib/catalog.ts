import type {Asset} from '@/domain/model';
import {
  ATLAS_FEED_ID_BY_ASSET_ID,
  ATLAS_FEED_IDS,
  ATLAS_FEED_SELECTION_POLICY,
  COMMON_ASSETS,
  COMMON_ASSET_INDEX_BY_ID,
  COMMON_ASSET_INDEX_BY_SYMBOL,
  GENERATED_AT_UTC,
  type CommonAsset,
} from '../data/commonAssets';

/** Atlas × PancakeSwap common-asset catalog (BNB Chain, chain 56) with its selected Atlas feed. */
export type CatalogAsset = Asset & {
  catalog: CommonAsset;
  feedId: number;
  /** "explicit_override" or "only_candidate_non_standard_weighting" deserve a reviewer's eye. */
  feedRule: CommonAsset['atlas_feed']['rule'];
};

const palette = ['#d96c32', '#647b94', '#ac8a48', '#52857c', '#8c7baf', '#b66a7e'];
const titleCase = (tag: string) => (tag.length <= 3 ? tag : tag[0] + tag.slice(1).toLowerCase());

export const catalogAssets: CatalogAsset[] = COMMON_ASSETS.map((asset, index) => ({
  id: asset.id,
  symbol: asset.symbol,
  name: asset.name,
  category: titleCase(asset.atlas_feed.tags[0] ?? 'CRYPTO'),
  price: null,
  color: palette[index % palette.length],
  oracle: 'unverified',
  chainId: asset.chain_id,
  metadataAddress: asset.address,
  decimals: asset.decimals,
  logoPath: asset.logo_path,
  eligibility: 'preview',
  backingNote: 'Asset-level identity match; not proof of backing or liquidity.',
  atlasFeedId: asset.atlas_feed.feed_id,
  atlasFeedName: asset.atlas_feed.feed_name,
  catalog: asset,
  feedId: asset.atlas_feed.feed_id,
  feedRule: asset.atlas_feed.rule,
}));

export const catalogFeedIds: readonly number[] = ATLAS_FEED_IDS;
export const feedIdByAssetId: Readonly<Record<string, number>> = ATLAS_FEED_ID_BY_ASSET_ID;
export const feedSelectionPolicy = ATLAS_FEED_SELECTION_POLICY;
export const catalogGeneratedAt = GENERATED_AT_UTC;

export function catalogAssetById(id: string): CatalogAsset | undefined {
  const index = (COMMON_ASSET_INDEX_BY_ID as Record<string, number>)[id.toLowerCase()];
  return index === undefined ? undefined : catalogAssets[index];
}

export function catalogAssetBySymbol(symbol: string): CatalogAsset | undefined {
  const index = (COMMON_ASSET_INDEX_BY_SYMBOL as Record<string, number>)[symbol.normalize('NFKC').trim().toUpperCase()];
  return index === undefined ? undefined : catalogAssets[index];
}
