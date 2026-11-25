'use client';
import {useMemo, useSyncExternalStore} from 'react';
import {describeApiError} from './api';
import type {SeriesPoint} from './history';
import {CHUNKS, type HistoryProgress} from './history-store';
import {useHistoryStore} from './prices';

export type HistoryStatus = 'loading' | 'ok' | 'error';

export interface AssetHistory {
  readonly status: HistoryStatus;
  readonly error: string | null;
  /** "now" for the chart window: time of the store's last update. */
  readonly now: number;
  readonly progress: HistoryProgress;
  series(assetId: string): SeriesPoint[];
  retry(): void;
}

const zero = () => 0;
const serverProgress: HistoryProgress = {chunksDone: 0, chunksTotal: CHUNKS, coveredMs: 0, done: false, error: null};

/**
 * History for the given assets over the last `windowMs`, read from the shared store
 * that is preloaded at start (24 h, all assets) and kept current. Issues no requests,
 * so switching asset or window is instant. `loading` means the preload has not yet
 * reached back across the window.
 */
export function useAssetHistory(assetIds: readonly string[], windowMs: number): AssetHistory {
  const store = useHistoryStore();
  const version = useSyncExternalStore(store.subscribe, store.getVersion, zero);
  const progress = useSyncExternalStore(store.subscribe, store.getProgress, () => serverProgress);
  const now = useSyncExternalStore(store.subscribe, store.getClock, zero);
  const key = assetIds.join('|');
  return useMemo(() => {
    const status: HistoryStatus = progress.error ? 'error' : progress.done || progress.coveredMs >= windowMs ? 'ok' : 'loading';
    return {
      status,
      error: progress.error ? describeApiError(progress.error) : null,
      now,
      progress,
      // version 0 = nothing loaded yet (also the server render).
      series: (assetId: string) => (version === 0 || !key.split('|').includes(assetId) ? [] : store.series(assetId, now, windowMs)),
      retry: () => store.retry(),
    };
  }, [store, key, windowMs, now, version, progress]);
}
