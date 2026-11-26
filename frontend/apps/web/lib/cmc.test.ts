import {describe, expect, it} from 'vitest';
import assetsFixture from './fixtures/cmc/assets.json';
import quotesFixture from './fixtures/cmc/quotes.json';
import historyFixture from './fixtures/cmc/history.json';
import {addDays, createCmcClient, lastDays, validDayRange, type CmcQuoteRow} from './cmc-api';
import {CmcPoller, mergeQuoteRows} from './cmc-poller';
import {byDecimalDesc, compareDecimal} from './decimal';
import type {Fetcher} from './api';
import {referenceAssetById} from './catalog';

const json = (status: number, body: unknown): Fetcher => async () => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
const XUSD = '56:0xf81ac2e1a0373dde1bce01e2fe694a9b7e3bfcb9';

describe('exact decimals', () => {
  it('compares sign, magnitude and fraction without floats', () => {
    expect(compareDecimal('41127905.676316235782677728', '41127905.676316235782677727')).toBe(1);
    expect(compareDecimal('-0.032313989307', '0.000949964021')).toBe(-1);
    expect(compareDecimal('-2', '-10')).toBe(1);
    expect(compareDecimal('007.50', '7.5')).toBe(0);
    expect(compareDecimal('-0.0', '0')).toBe(0);
  });
  it('sorts descending with nulls last and asset-id ties', () => {
    const rows = [{id: 'c', v: null}, {id: 'b', v: '5'}, {id: 'a', v: '5'}, {id: 'd', v: '-1'}];
    expect([...rows].sort(byDecimalDesc(r => r.v, r => r.id)).map(r => r.id)).toEqual(['a', 'b', 'd', 'c']);
  });
});

describe('CMC client (real backend fixtures)', () => {
  it('decodes approved mappings, joined by canonical asset id', async () => {
    const r = await createCmcClient({fetcher: json(200, assetsFixture)}).assets();
    expect(r.ok && r.value[0]).toMatchObject({assetId: XUSD, cmcId: 32372, kind: 'crypto', relation: 'underlying_reference'});
    expect(referenceAssetById(XUSD)).toBeDefined(); // fixture ids are registry ids
  });
  it('decodes quotes with exact decimal strings and percent units', async () => {
    const r = await createCmcClient({fetcher: json(200, quotesFixture)}).quotes([XUSD]);
    if (!r.ok) throw Error(r.error.kind);
    const q = r.value[0].quote!;
    expect(r.value[0].status).toBe('available');
    expect(q.marketCap).toBe('41127905.676316235782677728');
    expect(q.change90d).toBe('-0.032313989307');
    expect(q.rank).toBe(362);
    expect(q.tags).toContain('stablecoin');
    expect(Number.isFinite(q.timestampMs)).toBe(true);
  });
  it('decodes daily history and keeps missing days absent', async () => {
    const r = await createCmcClient({fetcher: json(200, historyFixture)}).history({assetIds: [XUSD], ...lastDays(30)});
    if (!r.ok) throw Error(r.error.kind);
    const s = r.value.series[0];
    expect(s.status).toBe('available');
    expect(s.points.length).toBe(historyFixture.series[0].points.length);
    expect(s.points[0]).toMatchObject({day: '2026-11-24', price: '0.9999376028346333'});
  });
  it('accepts a null quote and nullable market fields', async () => {
    const row = {...quotesFixture.quotes[0], status: 'pending', quote: null};
    const r = await createCmcClient({fetcher: json(200, {source: 'coinmarketcap', quotes: [row]})}).quotes();
    expect(r.ok && r.value[0].quote).toBeNull();
    const nulls = {...quotesFixture.quotes[0], quote: {...quotesFixture.quotes[0].quote, market_cap: null, rank: null, percent_change_7d: null}};
    const r2 = await createCmcClient({fetcher: json(200, {source: 'coinmarketcap', quotes: [nulls]})}).quotes();
    expect(r2.ok && r2.value[0].quote?.marketCap).toBeNull();
  });
  it('rejects malformed decimals, enums and dates; maps typed errors', async () => {
    const badDecimal = {...quotesFixture.quotes[0], quote: {...quotesFixture.quotes[0].quote, price: '1e5'}};
    expect((await createCmcClient({fetcher: json(200, {source: 'x', quotes: [badDecimal]})}).quotes()).ok).toBe(false);
    const badEnum = {assets: [{...assetsFixture.assets[0], mapping: {...assetsFixture.assets[0].mapping, relation: 'wrapper'}}]};
    expect((await createCmcClient({fetcher: json(200, badEnum)}).assets()).ok).toBe(false);
    const disabled = await createCmcClient({fetcher: json(503, {error: 'cmc_disabled'})}).quotes();
    expect(!disabled.ok && disabled.error.kind).toBe('cmc_disabled');
    const unknown = await createCmcClient({fetcher: json(400, {error: 'unknown_asset', asset_ids: ['x']})}).quotes(['x']);
    expect(!unknown.ok && unknown.error.kind).toBe('unknown_asset');
    const down = await createCmcClient({fetcher: async () => Promise.reject(new TypeError('fetch failed'))}).quotes();
    expect(!down.ok && down.error.kind).toBe('unreachable');
  });
  it('validates UTC day ranges: start inclusive, end exclusive, at most 365 days', () => {
    const now = Date.parse('2026-11-26T12:00:00Z');
    expect(lastDays(30, now)).toEqual({start: '2026-10-27', end: '2026-11-26'});
    expect(validDayRange('2026-10-27', '2026-11-26', now)).toBe(true);
    expect(validDayRange('2026-11-26', '2026-11-26', now)).toBe(false);
    expect(validDayRange(addDays('2026-11-26', -366), '2026-11-26', now)).toBe(false);
    expect(validDayRange('2026-11-20', '2026-12-05', now)).toBe(false);
  });
  it('sends repeated asset_id and explicit dates', async () => {
    let url = '';
    const fetcher: Fetcher = async input => { url = input; return new Response(JSON.stringify(historyFixture), {status: 200}); };
    await createCmcClient({fetcher, baseUrl: '/backend'}).history({assetIds: ['a', 'b'], start: '2026-11-19', end: '2026-11-26'});
    expect(url).toBe('/backend/v1/cmc/history?start=2026-11-19&end=2026-11-26&asset_id=a&asset_id=b');
  });
});

const row = (assetId: string, quote: Partial<NonNullable<CmcQuoteRow['quote']>> | null): CmcQuoteRow => ({
  assetId, symbol: assetId, mapping: null, status: quote ? 'available' : 'pending',
  quote: quote && {cmcId: 1, timestamp: '', timestampMs: 0, price: '1', marketCap: null, volume24h: null, rank: null, tags: [], change24h: null, change7d: null, change30d: null, change90d: null, fetchedAt: '', ...quote},
});

describe('CMC quote poller', () => {
  it('keeps the last valid quote when a later row is null or omitted; a valid quote replaces it regardless of time', () => {
    const first = mergeQuoteRows(new Map(), [row('a', {price: '2', timestampMs: 200}), row('b', {price: '3'})]);
    const second = mergeQuoteRows(first, [row('a', null)]);
    expect(second.get('a')?.quote?.price).toBe('2');
    expect(second.get('a')?.status).toBe('pending');
    expect(second.get('b')?.quote?.price).toBe('3');
    const older = mergeQuoteRows(second, [row('a', {price: '1.5', timestampMs: 100})]);
    expect(older.get('a')?.quote?.price).toBe('1.5');
  });
  it('polls without overlap, keeps data on failure and retries mappings until they arrive', async () => {
    const timers: (() => void)[] = [];
    let quoteCalls = 0, assetCalls = 0;
    const client = {
      assets: async () => (++assetCalls === 1 ? {ok: false as const, error: {kind: 'unreachable' as const, message: 'x'}} : {ok: true as const, value: [{assetId: 'a', cmcId: 1, kind: 'crypto' as const, relation: 'exact_token' as const, evidence: ''}]}),
      quotes: async () => (++quoteCalls === 2 ? {ok: false as const, error: {kind: 'unreachable' as const, message: 'x'}} : {ok: true as const, value: [row('a', {price: String(quoteCalls)})]}),
    };
    const poller = new CmcPoller({client, setTimer: cb => timers.push(cb), clearTimer: () => {}});
    poller.start();
    await new Promise(r => setTimeout(r, 0));
    expect(poller.getState().status).toBe('ok');
    expect(poller.getState().rows.get('a')?.quote?.price).toBe('1');
    expect(timers).toHaveLength(1); // next poll scheduled only after this one finished
    timers.shift()!();
    await new Promise(r => setTimeout(r, 0));
    expect(poller.getState().status).toBe('unreachable');
    expect(poller.getState().rows.get('a')?.quote?.price).toBe('1'); // cached value kept
    expect(poller.getState().mappings.size).toBe(1);
    timers.shift()!();
    await new Promise(r => setTimeout(r, 0));
    expect(assetCalls).toBe(2); // not requested again once mappings arrived
    poller.stop();
  });
});
