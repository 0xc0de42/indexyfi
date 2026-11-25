import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {createApiClient, historyPath, MAX_HISTORY_MS, parseAwareIso, type Fetcher} from './api';
import {BTCB, ETH, historyFixture, snapshotFixture} from './fixtures/wire';

const json = (status: number, body: unknown): Fetcher => async () =>
  new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});

describe('timestamps', () => {
  it('accepts Z, +00:00, other offsets and any fraction length', () => {
    expect(parseAwareIso('2026-11-25T18:36:00Z')).toBe(Date.UTC(2026, 10, 25, 18, 36));
    expect(parseAwareIso('2026-11-25T18:36:00+00:00')).toBe(Date.UTC(2026, 10, 25, 18, 36));
    expect(parseAwareIso('2026-11-25T18:36:00.123456+00:00')).toBe(Date.UTC(2026, 10, 25, 18, 36, 0, 123));
    expect(parseAwareIso('2026-11-25T20:36:00.5+02:00')).toBe(Date.UTC(2026, 10, 25, 18, 36, 0, 500));
  });
  it('rejects naive or malformed timestamps', () => {
    expect(parseAwareIso('2026-11-25T18:36:00')).toBeNull();
    expect(parseAwareIso('yesterday')).toBeNull();
  });
});

describe('snapshot', () => {
  it('decodes and keeps price strings exact', async () => {
    const result = await createApiClient({fetcher: json(200, snapshotFixture)}).snapshot();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.prices[0]).toEqual({assetId: BTCB, feedId: 632, price: '91234.123456789012345678', sourceTimestamp: 1795632958});
    expect(result.value.snapshotAt).toBe(snapshotFixture.snapshot_at);
    expect(result.value.snapshotAtMs).toBe(Date.UTC(2026, 10, 25, 18, 36, 0, 4));
  });
  it('maps 503 to not_initialized', async () => {
    const result = await createApiClient({fetcher: json(503, {error: 'not_initialized'})}).snapshot();
    expect(result).toEqual({ok: false, error: {kind: 'not_initialized'}});
  });
  it('maps network failure to unreachable', async () => {
    const result = await createApiClient({fetcher: async () => Promise.reject(new TypeError('fetch failed'))}).snapshot();
    expect(result).toEqual({ok: false, error: {kind: 'unreachable', message: 'fetch failed'}});
  });
  it('maps a non-JSON proxy 5xx to unreachable', async () => {
    const result = await createApiClient({fetcher: async () => new Response('Internal Server Error', {status: 500})}).snapshot();
    expect(result.ok || result.error.kind).toBe('unreachable');
  });
  it('rejects numeric prices, naive timestamps and missing fields', async () => {
    const bad = [
      {...snapshotFixture, prices: [{...snapshotFixture.prices[0], price: 91234.12}]},
      {...snapshotFixture, prices: [{...snapshotFixture.prices[0], price: '1e5'}]},
      {...snapshotFixture, snapshot_at: '2026-11-25T18:36:00'},
      {prices: []},
    ];
    for (const body of bad) {
      const result = await createApiClient({fetcher: json(200, body)}).snapshot();
      expect(result.ok || result.error.kind).toBe('decode');
    }
  });
  it('reports unexpected statuses as http', async () => {
    const result = await createApiClient({fetcher: json(404, {message: 'nope'})}).snapshot();
    expect(result).toEqual({ok: false, error: {kind: 'http', status: 404}});
  });
  it('reports aborts distinctly', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher: Fetcher = async (_input, init) => {
      if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      throw new Error('unreachable');
    };
    expect(await createApiClient({fetcher}).snapshot(controller.signal)).toEqual({ok: false, error: {kind: 'aborted'}});
  });
  it('uses no-store GET requests against the configured base', async () => {
    let seen: {url: string; init: RequestInit} | null = null;
    await createApiClient({
      baseUrl: 'http://example.test/',
      fetcher: async (url, init) => {
        seen = {url, init};
        return new Response(JSON.stringify(snapshotFixture), {status: 200});
      },
    }).snapshot();
    expect(seen).toMatchObject({url: 'http://example.test/snapshot', init: {method: 'GET', cache: 'no-store'}});
  });
});

describe('history', () => {
  const end = new Date('2026-11-25T18:40:00Z');
  const start = new Date(end.getTime() - 5 * 60_000);

  it('repeats asset_id parameters instead of joining them', () => {
    const path = historyPath({start, end, assetIds: [BTCB, ETH]});
    const params = new URLSearchParams(path.split('?')[1]);
    expect(params.getAll('asset_id')).toEqual([BTCB, ETH]);
    expect(path).not.toContain('%2C');
    expect(params.get('start')).toBe('2026-11-25T18:35:00.000Z');
    expect(params.get('end')).toBe('2026-11-25T18:40:00.000Z');
  });
  it('decodes snapshots chronologically and accepts empty arrays', async () => {
    const result = await createApiClient({fetcher: json(200, historyFixture)}).history({start, end, assetIds: [BTCB]});
    expect(result.ok && result.value.map(s => s.prices[0].price)).toEqual(['91200', '91210.5']);
    expect(await createApiClient({fetcher: json(200, {snapshots: []})}).history({start, end})).toEqual({ok: true, value: []});
  });
  it('maps 400 and 500 error bodies', async () => {
    expect(await createApiClient({fetcher: json(400, {error: 'invalid_time_range'})}).history({start, end})).toEqual({
      ok: false,
      error: {kind: 'invalid_time_range'},
    });
    expect(await createApiClient({fetcher: json(500, {error: 'history_read_failed'})}).history({start, end})).toEqual({
      ok: false,
      error: {kind: 'history_read_failed'},
    });
  });
  it('enforces a positive range of at most 24 hours before calling the server', async () => {
    let calls = 0;
    const client = createApiClient({fetcher: async () => (calls++, new Response(JSON.stringify({snapshots: []})))});
    expect((await client.history({start: end, end})).ok).toBe(false);
    expect((await client.history({start: new Date(end.getTime() - MAX_HISTORY_MS - 1), end})).ok).toBe(false);
    expect(calls).toBe(0);
    expect((await client.history({start: new Date(end.getTime() - MAX_HISTORY_MS), end})).ok).toBe(true);
    expect(calls).toBe(1);
  });
});

describe('against a mock HTTP server', () => {
  let server: Server;
  let base = '';
  const requests: string[] = [];
  let ready = false;

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      requests.push(req.url ?? '');
      const url = new URL(req.url ?? '/', 'http://mock');
      const send = (status: number, body: unknown) => {
        res.writeHead(status, {'Content-Type': 'application/json'});
        res.end(JSON.stringify(body));
      };
      if (url.pathname === '/snapshot') return ready ? send(200, snapshotFixture) : send(503, {error: 'not_initialized'});
      if (url.pathname === '/history') {
        const wanted = url.searchParams.getAll('asset_id');
        const snapshots = historyFixture.snapshots
          .map(s => ({...s, prices: s.prices.filter(p => !wanted.length || wanted.includes(p.asset_id))}))
          .filter(s => s.prices.length);
        return send(200, {snapshots});
      }
      send(404, {});
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  it('goes from not_initialized to a full snapshot', async () => {
    const client = createApiClient({baseUrl: base});
    expect(await client.snapshot()).toEqual({ok: false, error: {kind: 'not_initialized'}});
    ready = true;
    const result = await client.snapshot();
    expect(result.ok && result.value.prices.map(p => p.assetId)).toEqual([BTCB, ETH]);
  });
  it('filters history by repeated asset_id and returns empty for unknown assets', async () => {
    const client = createApiClient({baseUrl: base});
    const end = new Date('2026-11-25T18:40:00Z');
    const start = new Date('2026-11-25T18:30:00Z');
    expect(await client.history({start, end, assetIds: ['56:0x0000000000000000000000000000000000000000']})).toEqual({ok: true, value: []});
    const result = await client.history({start, end, assetIds: [BTCB, ETH]});
    expect(result.ok && result.value).toHaveLength(2);
    expect(requests.at(-1)).toMatch(/asset_id=.*&asset_id=/);
  });
  it('reports a closed port as unreachable', async () => {
    const result = await createApiClient({baseUrl: 'http://127.0.0.1:9'}).snapshot();
    expect(result.ok || result.error.kind).toBe('unreachable');
  });
});
