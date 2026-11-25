'use client';
import {createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode} from 'react';
import {api, type AssetPrice, type PriceSnapshot} from './api';
import {HistoryStore} from './history-store';
import {INITIAL_PRICE_STATE, PricePoller, type PriceState} from './poller';

/**
 * App-level price and history stores. Exactly one PricePoller and one HistoryStore exist
 * per browser tab; components select from them by canonical asset ID and never issue
 * their own `/snapshot` or `/history` requests.
 */
const PollerContext = createContext<{poller: PricePoller; history: HistoryStore} | null>(null);

export function PriceProvider({children}: {children: ReactNode}) {
  const [value] = useState(() => ({poller: new PricePoller({client: api}), history: new HistoryStore({client: api})}));
  useEffect(() => {
    const {poller, history} = value;
    const unsubscribe = poller.onSnapshot(snapshot => history.addSnapshot(snapshot));
    poller.start();
    history.start();
    return () => {
      unsubscribe();
      poller.stop();
      history.stop();
    };
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

/** Shared 24 h history of every reference asset (preloaded at start). */
export function useHistoryStore(): HistoryStore {
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
