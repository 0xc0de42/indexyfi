import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {HistoryRequest, PriceSnapshot, Result} from './api';
import {CHUNK_MS, CHUNKS, HISTORY_SPAN_MS, HistoryStore, LIVE_KEEP_MS} from './history-store';
import {BTCB, ETH} from './fixtures/wire';

const T0 = Date.UTC(2026, 10, 25, 19, 30, 20);
const snap = (ms: number, prices: Record<string, string>): PriceSnapshot => ({
  snapshotAt: new Date(ms).toISOString(),
  snapshotAtMs: ms,
  prices: Object.entries(prices).map(([assetId, price]) => ({assetId, feedId: 1, price, sourceTimestamp: Math.floor(ms / 1000)})),
});

/** Fake backend: one close per minute in [from, to) for BTCB and ETH. */
function backend(from: number, to: number) {
  const closes: PriceSnapshot[] = [];
  for (let t = Math.ceil(from / 60_000) * 60_000; t < to; t += 60_000) closes.push(snap(t + 999, {[BTCB]: String(t / 60_000), [ETH]: '1'}));
  const requests: HistoryRequest[] = [];
  const history = vi.fn(async (request: HistoryRequest): Promise<Result<readonly PriceSnapshot[]>> => {
    requests.push(request);
    return {ok: true, value: closes.filter(s => s.snapshotAtMs >= request.start.getTime() && s.snapshotAtMs < request.end.getTime())};
  });
  return {history, requests, closes};
}

describe('HistoryStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it('preloads 24 h for all assets in sequential 1 h chunks, newest first', async () => {
    const {history} = backend(T0 - 3 * CHUNK_MS, T0);
    const store = new HistoryStore({client: {history}});
    let inFlight = 0;
    let maxInFlight = 0;
    history.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return {ok: true, value: []};
    });
    store.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.getProgress()).toMatchObject({chunksDone: CHUNKS, done: true, coveredMs: HISTORY_SPAN_MS, error: null});
    expect(history).toHaveBeenCalledTimes(CHUNKS);
    const calls = history.mock.calls.map(([request]) => request);
    expect(calls[0].end.getTime()).toBe(T0);
    for (const request of calls) {
      expect(request.end.getTime() - request.start.getTime()).toBe(CHUNK_MS);
      expect(request.assetIds).toBeUndefined();
    }
    expect(calls.at(-1)!.start.getTime()).toBe(T0 - HISTORY_SPAN_MS);
    expect(maxInFlight).toBe(1);
    store.stop();
  });

  it('serves every window up to 24 h from the preload without further requests', async () => {
    const {history} = backend(T0 - 3 * CHUNK_MS, T0);
    const store = new HistoryStore({client: {history}});
    store.start();
    await vi.advanceTimersByTimeAsync(5_000);
    const calls = history.mock.calls.length;
    expect(store.series(BTCB, T0, 5 * 60_000)).toHaveLength(5);
    expect(store.series(BTCB, T0, CHUNK_MS)).toHaveLength(60);
    expect(store.series(ETH, T0, HISTORY_SPAN_MS)).toHaveLength(180);
    expect(history.mock.calls.length).toBe(calls);
    store.stop();
  });

  it('appends live samples, dedupes them against closes and bounds the buffer', async () => {
    const {history} = backend(T0 - CHUNK_MS, T0);
    const store = new HistoryStore({client: {history}});
    store.start();
    await vi.advanceTimersByTimeAsync(5_000);
    const lastClose = store.series(BTCB, T0, 60_000).at(-1)!;
    store.addSnapshot(snap(lastClose.t, {[BTCB]: 'dup'}));
    store.addSnapshot(snap(T0 + 1_000, {[BTCB]: 'live'}));
    const series = store.series(BTCB, T0 + 1_000, 5 * 60_000);
    expect(series.filter(p => p.t === lastClose.t)).toHaveLength(1);
    expect(series.at(-1)).toMatchObject({price: 'live', origin: 'live'});
    for (let i = 2; i < LIVE_KEEP_MS / 1_000 + 120; i++) store.addSnapshot(snap(T0 + i * 1_000, {[BTCB]: 'x'}));
    const live = store.series(BTCB, T0 + LIVE_KEEP_MS + 200_000, HISTORY_SPAN_MS).filter(p => p.origin === 'live');
    expect(live.length).toBeLessThanOrEqual(LIVE_KEEP_MS / 1_000 + 1);
    store.stop();
  });

  it('fetches new minute closes after each boundary with an overlap', async () => {
    const {history, closes} = backend(T0 - CHUNK_MS, T0);
    const store = new HistoryStore({client: {history}});
    store.start();
    await vi.advanceTimersByTimeAsync(5_000);
    const before = history.mock.calls.length;
    // The close of the boot minute is persisted only at the next boundary.
    closes.push(snap(Date.UTC(2026, 10, 25, 19, 30, 59), {[BTCB]: 'boot-minute-close'}));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(history.mock.calls.length).toBe(before + 1);
    const refresh = history.mock.calls.at(-1)![0];
    expect(refresh.start.getTime()).toBeLessThan(T0);
    expect(store.series(BTCB, Date.now(), 5 * 60_000).some(p => p.price === 'boot-minute-close')).toBe(true);
    store.stop();
  });

  it('reports a failed chunk, keeps loaded data and resumes on retry', async () => {
    const {history} = backend(T0 - 2 * CHUNK_MS, T0);
    const real = history.getMockImplementation()!;
    let fail = true;
    history.mockImplementation(async request => {
      if (request.end.getTime() === T0 - CHUNK_MS && fail) return {ok: false, error: {kind: 'unreachable', message: 'down'}};
      return real(request);
    });
    const store = new HistoryStore({client: {history}});
    store.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(store.getProgress()).toMatchObject({chunksDone: 1, done: false, error: {kind: 'unreachable'}});
    expect(store.series(BTCB, T0, CHUNK_MS)).toHaveLength(60);
    fail = false;
    store.retry();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(store.getProgress()).toMatchObject({done: true, error: null});
    expect(store.series(BTCB, T0, 3 * CHUNK_MS)).toHaveLength(120);
    store.stop();
  });

  it('is restartable after stop (React strict mode) without refetching loaded chunks', async () => {
    const {history} = backend(T0 - CHUNK_MS, T0);
    const store = new HistoryStore({client: {history}});
    store.start();
    store.stop();
    store.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(store.getProgress().done).toBe(true);
    expect(history.mock.calls.length).toBe(CHUNKS + 1); // the aborted first request is retried once
    store.stop();
  });
});
