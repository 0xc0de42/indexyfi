import {describe, expect, it} from 'vitest';
import {queryAssets, type AssetData} from './asset-query';
import type {CmcQuote} from './cmc-api';
import {referenceAssets} from './catalog';

const [a, b, c, d] = referenceAssets.filter(x => x.category === 'Crypto').slice(0, 4);
const etf = referenceAssets.find(x => x.category === 'ETF')!;
const quote = (q: Partial<CmcQuote>): CmcQuote => ({cmcId: 1, timestamp: '', timestampMs: 0, price: '1', marketCap: null, volume24h: null, rank: null, tags: [], change24h: null, change7d: null, change30d: null, change90d: null, fetchedAt: '', ...q});
const data = new Map<string, AssetData>([
  [a.id, {price: '10', atlasChange: 2.5, quote: quote({marketCap: '900.5', change24h: '-3.2', tags: ['defi']})}],
  [b.id, {price: '9.99', atlasChange: -1, quote: quote({marketCap: '41127905.676316235782677728', change24h: '1.1', tags: ['defi', 'stablecoin']})}],
  [c.id, {price: '100', atlasChange: null, quote: null}],
  [d.id, {price: undefined, atlasChange: null, quote: quote({marketCap: '41127905.676316235782677729', change24h: '0', tags: []})}],
  [etf.id, {price: '500', quote: quote({marketCap: '5', tags: ['etf']})}],
]);
const all = [a, b, c, d, etf];
const dataOf = (x: typeof a) => data.get(x.id) ?? {};
const ids = (xs: typeof all) => xs.map(x => x.id);

describe('asset filtering and sorting by Atlas and CMC data', () => {
  it('sorts CMC market cap exactly (beyond float precision), missing values last in both directions', () => {
    expect(ids(queryAssets(all, {sort: 'cap'}, dataOf))).toEqual([d.id, b.id, a.id, etf.id, c.id]);
    expect(ids(queryAssets(all, {sort: 'cap', direction: 'asc'}, dataOf))).toEqual([etf.id, a.id, b.id, d.id, c.id]);
  });
  it('sorts negative changes correctly and Atlas change numerically', () => {
    expect(ids(queryAssets(all, {sort: 'ch24'}, dataOf)).slice(0, 3)).toEqual([b.id, d.id, a.id]);
    expect(ids(queryAssets(all, {sort: 'atlasChange'}, dataOf)).slice(0, 2)).toEqual([a.id, b.id]);
    expect(ids(queryAssets(all, {sort: 'price'}, dataOf))[0]).toBe(etf.id);
    expect(ids(queryAssets(all, {sort: 'price'}, dataOf)).at(-1)).toBe(d.id); // no Atlas price yet
  });
  it('filters by category and search term together', () => {
    expect(ids(queryAssets(all, {sort: 'symbol', category: 'ETF'}, dataOf))).toEqual([etf.id]);
    // Contract addresses are unique, so they make an unambiguous search term.
    expect(ids(queryAssets(all, {sort: 'symbol', category: 'Crypto', term: b.address.toUpperCase()}, dataOf))).toEqual([b.id]);
    expect(queryAssets(all, {sort: 'symbol', category: 'ETF', term: a.address}, dataOf)).toEqual([]);
  });
  it('symbol sort is alphabetical and reversible', () => {
    const asc = queryAssets(all, {sort: 'symbol'}, dataOf).map(x => x.symbol);
    expect(asc).toEqual([...asc].sort((x, y) => x.localeCompare(y, 'en')));
    expect(queryAssets(all, {sort: 'symbol', direction: 'desc'}, dataOf).map(x => x.symbol)).toEqual([...asc].reverse());
  });
});
