import type {Asset} from '@/domain/model';
import type {CmcQuote} from './cmc-api';
import {compareDecimal} from './decimal';

/**
 * Shared filtering and sorting of reference assets by Atlas oracle and CMC data (Assets page, Create composition).
 * Pure: callers pass the per-asset data. Exact decimal strings are compared exactly; derived numbers numerically.
 * Assets without a value for the chosen metric always sort last, in either direction; ties by canonical id.
 */
export type AssetSort = 'symbol' | 'price' | 'atlasChange' | 'cap' | 'volume' | 'ch24' | 'ch7' | 'ch30';
export type SortDirection = 'desc' | 'asc';

export const ASSET_SORTS: readonly {value: AssetSort; label: string; source: 'Atlas' | 'CMC' | null}[] = [
  {value: 'symbol', label: 'Symbol', source: null},
  {value: 'price', label: 'Atlas price', source: 'Atlas'},
  {value: 'atlasChange', label: 'Atlas change (stored, ≤24h)', source: 'Atlas'},
  {value: 'cap', label: 'CMC market cap', source: 'CMC'},
  {value: 'volume', label: 'CMC 24h volume', source: 'CMC'},
  {value: 'ch24', label: 'CMC 24h change', source: 'CMC'},
  {value: 'ch7', label: 'CMC 7d change', source: 'CMC'},
  {value: 'ch30', label: 'CMC 30d change', source: 'CMC'},
];
export const defaultDirection = (sort: AssetSort): SortDirection => (sort === 'symbol' ? 'asc' : 'desc');

export interface AssetData {
  /** Latest Atlas reference price, exact decimal string. */
  readonly price?: string;
  /** Atlas reference change, percent, over the stored history within the last 24 h (at least 1 h); null otherwise. */
  readonly atlasChange?: number | null;
  /** Span that change covers, ms. */
  readonly atlasSpanMs?: number | null;
  readonly quote?: CmcQuote | null;
}
export interface AssetQuery {
  readonly term?: string;
  /** 'All' or a reference category. */
  readonly category?: string;
  readonly sort: AssetSort;
  readonly direction?: SortDirection;
}

export function sortValue(sort: AssetSort, data: AssetData): string | number | null {
  const q = data.quote;
  switch (sort) {
    case 'symbol': return null;
    case 'price': return data.price ?? null;
    case 'atlasChange': return data.atlasChange ?? null;
    case 'cap': return q?.marketCap ?? null;
    case 'volume': return q?.volume24h ?? null;
    case 'ch24': return q?.change24h ?? null;
    case 'ch7': return q?.change7d ?? null;
    case 'ch30': return q?.change30d ?? null;
  }
}

const compareValues = (a: string | number, b: string | number) =>
  typeof a === 'number' && typeof b === 'number' ? Math.sign(a - b) : compareDecimal(String(a), String(b));

export function queryAssets(assets: readonly Asset[], query: AssetQuery, dataOf: (asset: Asset) => AssetData): Asset[] {
  const term = (query.term ?? '').trim().toLowerCase();
  const rows = assets.filter(asset => {
    if (query.category && query.category !== 'All' && asset.category !== query.category) return false;
    return !term || `${asset.symbol} ${asset.name} ${asset.address} ${asset.feedId} ${asset.feedName}`.toLowerCase().includes(term);
  });
  const direction = query.direction ?? defaultDirection(query.sort);
  const sign = direction === 'asc' ? 1 : -1;
  if (query.sort === 'symbol') return rows.sort((a, b) => sign * a.symbol.localeCompare(b.symbol, 'en') || a.id.localeCompare(b.id));
  const keyed = rows.map(asset => ({asset, v: sortValue(query.sort, dataOf(asset))}));
  keyed.sort((a, b) => {
    if (a.v === null || b.v === null) return a.v === b.v ? a.asset.id.localeCompare(b.asset.id) : a.v === null ? 1 : -1;
    return sign * compareValues(a.v, b.v) || a.asset.id.localeCompare(b.asset.id);
  });
  return keyed.map(k => k.asset);
}

