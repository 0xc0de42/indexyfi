'use client';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {api, describeApiError, MAX_HISTORY_MS, type PriceSnapshot} from './api';
import {SeriesTracker, type SeriesPoint} from './history';
import {useSnapshotListener} from './prices';

export type HistoryStatus = 'loading' | 'ok' | 'error';

export interface AssetHistory {
  readonly status: HistoryStatus;
  readonly error: string | null;
  /** Browser time used to bound the window on the latest render. */
  readonly now: number;
  series(assetId: string): SeriesPoint[];
  retry(): void;
}

/**
 * History for the given assets over the last `windowMs`: fetched once per
 * (assets, window) change, then extended by live snapshots. Outdated requests are
 * aborted. History errors never affect live prices.
 */
export function useAssetHistory(assetIds: readonly string[], windowMs: number): AssetHistory {
  const key = assetIds.join('|');
  const ids = useMemo(() => (key ? key.split('|') : []), [key]);
  const window = Math.min(Math.max(windowMs, 60_000), MAX_HISTORY_MS);
  const tracker = useRef<SeriesTracker | null>(null);
  if (!tracker.current) tracker.current = new SeriesTracker(ids);
  const [status, setStatus] = useState<HistoryStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const current = tracker.current!;
    current.track(ids);
    if (!ids.length) {
      setStatus('ok');
      return;
    }
    const controller = new AbortController();
    const end = new Date();
    setStatus('loading');
    setError(null);
    void api.history({start: new Date(end.getTime() - window), end, assetIds: ids}, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        current.setHistory(result.value);
        setStatus('ok');
      } else if (result.error.kind !== 'aborted') {
        current.clearHistory();
        setStatus('error');
        setError(describeApiError(result.error));
      }
      setNow(Date.now());
      setVersion(v => v + 1);
    });
    return () => controller.abort();
  }, [ids, window, attempt]);

  const onSnapshot = useCallback((snapshot: PriceSnapshot) => {
    tracker.current!.addLive(snapshot);
    setNow(Date.now());
    setVersion(v => v + 1);
  }, []);
  useSnapshotListener(onSnapshot);

  return useMemo(
    () => ({
      status,
      error,
      now,
      series: (assetId: string) => tracker.current!.series(assetId, now, window),
      retry: () => setAttempt(a => a + 1),
    }),
    // version changes whenever the tracker's contents change.
    [status, error, now, window, version],
  );
}
