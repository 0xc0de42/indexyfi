import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {ApiError, PriceSnapshot, Result} from './api';
import {PricePoller} from './poller';
import {BTCB, ETH} from './fixtures/wire';

const snap = (price: string, at = '2026-11-25T18:36:00Z'): PriceSnapshot => ({
  snapshotAt: at,
  snapshotAtMs: Date.parse(at),
  prices: [
    {assetId: BTCB, feedId: 632, price, sourceTimestamp: 1},
    {assetId: ETH, feedId: 641, price: '3000', sourceTimestamp: 1},
  ],
});
const fail = (error: ApiError): Result<PriceSnapshot> => ({ok: false, error});
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('PricePoller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fetches immediately, then once per second', async () => {
    const snapshot = vi.fn(async () => ({ok: true, value: snap('1')}) as Result<PriceSnapshot>);
    const poller = new PricePoller({client: {snapshot}});
    poller.start();
    await flush();
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(poller.getState().status).toBe('ok');
    await vi.advanceTimersByTimeAsync(999);
    expect(snapshot).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(snapshot).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(snapshot).toHaveBeenCalledTimes(5);
    poller.stop();
  });

  it('never overlaps requests when the server is slow', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const snapshot = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 2_500));
      inFlight--;
      return {ok: true, value: snap('1')} as Result<PriceSnapshot>;
    });
    const poller = new PricePoller({client: {snapshot}});
    poller.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(maxInFlight).toBe(1);
    expect(snapshot).toHaveBeenCalledTimes(4); // 0, 2.5, 5, 7.5 s
    poller.stop();
  });

  it('keeps the last snapshot on errors and distinguishes them', async () => {
    const results: Result<PriceSnapshot>[] = [
      fail({kind: 'not_initialized'}),
      {ok: true, value: snap('10')},
      fail({kind: 'unreachable', message: 'down'}),
      fail({kind: 'http', status: 502}),
    ];
    const poller = new PricePoller({client: {snapshot: async () => results.shift()!}});
    poller.start();
    await flush();
    expect(poller.getState()).toMatchObject({status: 'not_initialized', snapshot: null});
    await vi.advanceTimersByTimeAsync(1_000);
    expect(poller.getState().byAsset.get(BTCB)?.price).toBe('10');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(poller.getState()).toMatchObject({status: 'unreachable'});
    expect(poller.getState().byAsset.get(BTCB)?.price).toBe('10');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(poller.getState()).toMatchObject({status: 'error', error: {kind: 'http', status: 502}});
    expect(poller.getState().snapshot?.prices[0].price).toBe('10');
    poller.stop();
  });

  it('replaces the whole snapshot atomically', async () => {
    const results: Result<PriceSnapshot>[] = [
      {ok: true, value: snap('1')},
      {ok: true, value: {...snap('2'), prices: [{assetId: BTCB, feedId: 632, price: '2', sourceTimestamp: 2}]}},
    ];
    const poller = new PricePoller({client: {snapshot: async () => results.shift()!}});
    poller.start();
    await flush();
    const first = poller.getState();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(poller.getState().byAsset.has(ETH)).toBe(false);
    expect(first.byAsset.get(ETH)?.price).toBe('3000');
    poller.stop();
  });

  it('aborts on stop and ignores responses from a stopped generation', async () => {
    const signals: AbortSignal[] = [];
    let resolveFirst: (value: Result<PriceSnapshot>) => void = () => undefined;
    let calls = 0;
    const poller = new PricePoller({
      client: {
        snapshot: signal => {
          signals.push(signal!);
          calls++;
          if (calls === 1) return new Promise(resolve => (resolveFirst = resolve));
          return Promise.resolve({ok: true, value: snap('new')});
        },
      },
    });
    poller.start();
    poller.stop();
    expect(signals[0].aborted).toBe(true);
    poller.start();
    await flush();
    resolveFirst({ok: true, value: snap('old')});
    await flush();
    expect(poller.getState().byAsset.get(BTCB)?.price).toBe('new');
    poller.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toBe(2);
  });

  it('serves any number of subscribers from one request stream', async () => {
    const snapshot = vi.fn(async () => ({ok: true, value: snap('1')}) as Result<PriceSnapshot>);
    const poller = new PricePoller({client: {snapshot}});
    const listeners = Array.from({length: 25}, () => vi.fn());
    listeners.forEach(listener => poller.subscribe(listener));
    const onSnapshot = vi.fn();
    poller.onSnapshot(onSnapshot);
    poller.start();
    poller.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(snapshot).toHaveBeenCalledTimes(3);
    expect(onSnapshot).toHaveBeenCalledTimes(3);
    listeners.forEach(listener => expect(listener).toHaveBeenCalled());
    poller.stop();
  });
});
