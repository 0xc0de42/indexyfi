import {describe, expect, it, vi} from 'vitest';
import {decodeAtlasPayload, parseFeedIds, pricesByFeed, NO_PRICES, FEEDS_PER_PAYLOAD} from './atlas-signed';
import {fetchAtlasSigned} from './server/atlas-pull';
import {signedPrices} from './vaults';

const hex = (n: bigint, bytes: number) => n.toString(16).padStart(bytes * 2, '0');
const payloadFor = (records: {feed: number; price: bigint; ts: number}[]) =>
  `0x${records.map(r => hex(BigInt(r.feed), 4) + hex(r.price, 10) + hex(BigInt(r.ts), 6)).join('')}${hex(BigInt(records.length), 1)}` as const;
const SIG = `0x${'ab'.repeat(65)}` as const;
const KEY = 'test-key-never-logged-1234567890';

describe('Atlas signed prices', () => {
  it('decodes the documented Atlas example exactly', () => {
    // From the Atlas Pull API reference: feed 624, price 999832025250886479 (18 decimals), ts 1780993491.
    expect(decodeAtlasPayload('0x0000027000000de01dedfc23734f00006a27cdd301')).toEqual([
      {feedId: 624, price18: 999832025250886479n, timestamp: 1780993491},
    ]);
    expect(() => decodeAtlasPayload('0x00')).toThrow();
    expect(() => decodeAtlasPayload('0x0000027000000de01dedfc23734f00006a27cd01')).toThrow();
  });

  it('validates requested feeds', () => {
    const allowed = new Set([751, 632, 956]);
    expect(parseFeedIds('751,632', allowed)).toEqual([751, 632]);
    expect(() => parseFeedIds(null, allowed)).toThrow('required');
    expect(() => parseFeedIds('751,751', allowed)).toThrow('repeat');
    expect(() => parseFeedIds('751,-1', allowed)).toThrow('positive');
    expect(() => parseFeedIds('751,999', allowed)).toThrow('unknown feeds: 999');
    const many = new Set(Array.from({length: 40}, (_, i) => i + 1));
    expect(() => parseFeedIds(Array.from({length: 33}, (_, i) => i + 1).join(','), many)).toThrow('at most 32');
  });

  it('keeps the newest price per feed across payloads', () => {
    const latest = pricesByFeed({
      payloads: [payloadFor([{feed: 751, price: 1n, ts: 100}]), payloadFor([{feed: 751, price: 2n, ts: 200}, {feed: 632, price: 3n, ts: 150}])],
      signatures: [SIG, SIG],
    });
    expect(latest.get(751)?.price18).toBe(2n);
    expect(latest.get(632)?.price18).toBe(3n);
  });

  it('requests signed prices in chunks of 20 with the key only in the header', async () => {
    const feeds = Array.from({length: 25}, (_, i) => 1000 + i);
    const calls: {headers: Record<string, string>; body: {feedIds: string[]; signed: boolean}}[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {feedIds: string[]; signed: boolean};
      calls.push({headers: init?.headers as Record<string, string>, body});
      const payload = payloadFor(body.feedIds.map(f => ({feed: Number(f), price: 10n ** 18n, ts: 1})));
      return new Response(JSON.stringify({data: {payload, signature: SIG}, status: {error_code: '0'}}));
    }) as unknown as typeof fetch;
    const out = await fetchAtlasSigned(feeds, KEY, fetchImpl);
    expect(calls.map(c => c.body.feedIds.length)).toEqual([FEEDS_PER_PAYLOAD, 5]);
    expect(calls.every(c => c.body.signed === true && c.headers['X-API-KEY'] === KEY)).toBe(true);
    expect(out.payloads).toHaveLength(2);
    expect(out.signatures).toEqual([SIG, SIG]);
  });

  it('rejects unsigned, incomplete or failed responses without leaking the key', async () => {
    const respond = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), {status})) as unknown as typeof fetch;
    const full = payloadFor([{feed: 751, price: 1n, ts: 1}, {feed: 632, price: 1n, ts: 1}]);
    await expect(fetchAtlasSigned([751, 632], KEY, respond({data: {payload: full}, status: {error_code: '0'}}))).rejects.toThrow('unsigned');
    await expect(fetchAtlasSigned([751, 632], KEY, respond({data: {payload: payloadFor([{feed: 751, price: 1n, ts: 1}]), signature: SIG}, status: {error_code: '0'}})))
      .rejects.toThrow('does not cover');
    const failed = fetchAtlasSigned([751], KEY, respond({data: null, status: {error_code: 'Unauthorized', error_message: 'API Key is invalid'}}, 401));
    await expect(failed).rejects.toThrow('HTTP 401: API Key is invalid');
    await expect(fetchAtlasSigned([751], KEY, respond({}, 500))).rejects.not.toThrow(KEY);
    await expect(fetchAtlasSigned([751], '', respond({}))).rejects.toThrow('not configured');
  });

  it('injects nothing on the local fixture', async () => {
    await expect(signedPrices({fixture: true}, [751, 632])).resolves.toBe(NO_PRICES);
  });
});
