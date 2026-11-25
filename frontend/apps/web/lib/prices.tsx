'use client';
import {createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode} from 'react';
import {api, type AssetPrice, type PriceSnapshot} from './api';
import {RecentHistoryCache} from './history-cache';
import {INITIAL_PRICE_STATE, PricePoller, type PriceState} from './poller';

/**
 * App-level price store. Exactly one PricePoller exists per browser tab; components
 * select from it by canonical asset ID and never issue their own `/snapshot` requests.
 */
const PollerContext = createContext<{poller: PricePoller; history: RecentHistoryCache} | null>(null);

export function PriceProvider({children}: {children: ReactNode}) {
  const [value] = useState(() => ({poller: new PricePoller({client: api}), history: new RecentHistoryCache(api)}));
  useEffect(() => {
    value.poller.start();
    void value.history.prefetch();
    return () => value.poller.stop();
  }, [value]);
  return <PollerContext.Provider value={value}>{children}</PollerContext.Provider>;
}

function useStore() {
  const store = useContext(PollerContext);
  if (!store) throw Error('PriceProvider missing');
  return store;
}

function usePoller(): PricePoller {
  return useStore().poller;
}

/** The start-up history prefetch shared by the loader and the first charts. */
export function useHistoryCache(): RecentHistoryCache {
  return useStore().history;
}

const serverState = () => INITIAL_PRICE_STATE;

export function usePriceState(): PriceState {
  const poller = usePoller();
  return useSyncExternalStore(poller.subscribe, poller.getState, serverState);
}

export function useAssetPrice(assetId: string): AssetPrice | undefined {
  const poller = usePoller();
  return useSyncExternalStore(
    poller.subscribe,
    () => poller.getState().byAsset.get(assetId),
    () => undefined,
  );
}

/** Subscribe to each new snapshot (for chart appends). The latest snapshot is replayed on subscribe. */
export function useSnapshotListener(listener: (snapshot: PriceSnapshot) => void): void {
  const poller = usePoller();
  useEffect(() => {
    const current = poller.getState().snapshot;
    if (current) listener(current);
    return poller.onSnapshot(listener);
  }, [poller, listener]);
}

/** Re-render every `intervalMs` so ages stay current. */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
