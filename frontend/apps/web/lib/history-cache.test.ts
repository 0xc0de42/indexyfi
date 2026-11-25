import {describe, expect, it, vi} from 'vitest';
import type {HistoryRequest, PriceSnapshot, Result} from './api';
import {BOOT_HISTORY_MS, RecentHistoryCache} from './history-cache';

const T = Date.UTC(2026, 10, 25, 19, 30, 10);
const snapshots: PriceSnapshot[] = [{snapshotAt: '2026-11-25T19:30:00Z', snapshotAtMs: Date.UTC(2026, 10, 25, 19, 30), prices: []}];

function setup(result: Result<readonly PriceSnapshot[]> = {ok: true, value: snapshots}) {
  let now = T;
  const history = vi.fn(async (_request: HistoryRequest) => result);
  const cache = new RecentHistoryCache({history}, () => now);
  return {cache, history, advance: (ms: number) => (now += ms)};
}

describe('RecentHistoryCache', () => {
  it('prefetches the last five minutes of all assets exactly once', async () => {
    const {cache, history} = setup();
    await Promise.all([cache.prefetch(), cache.prefetch(), cache.usable(BOOT_HISTORY_MS)]);
    expect(history).toHaveBeenCalledTimes(1);
    const request = history.mock.calls[0][0];
    expect(request.end.getTime() - request.start.getTime()).toBe(BOOT_HISTORY_MS);
    expect(request.assetIds).toBeUndefined();
  });

  it('serves charts of up to five minutes within the same UTC minute', async () => {
    const {cache, advance} = setup();
    expect(await cache.usable(BOOT_HISTORY_MS)).toBe(snapshots);
    advance(40_000);
    expect(await cache.usable(60_000)).toBe(snapshots);
  });

  it('refuses longer windows and requests after the next minute boundary', () => {
    const {cache, advance} = setup();
    void cache.prefetch();
    expect(cache.usable(15 * 60_000)).toBeNull();
    advance(50_000);
    expect(cache.usable(BOOT_HISTORY_MS)).toBeNull();
  });

  it('lets a chart that mounts first start the boot request (no duplicate)', async () => {
    const {cache, history} = setup();
    const fromChart = cache.usable(BOOT_HISTORY_MS);
    await cache.prefetch();
    expect(await fromChart).toBe(snapshots);
    expect(history).toHaveBeenCalledTimes(1);
  });

  it('falls back (null) when the boot request failed', async () => {
    const {cache} = setup({ok: false, error: {kind: 'unreachable', message: 'down'}});
    expect(await cache.usable(BOOT_HISTORY_MS)).toBeNull();
  });
});
