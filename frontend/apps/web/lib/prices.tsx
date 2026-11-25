'use client';
import {createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode} from 'react';
import {api, type AssetPrice, type PriceSnapshot} from './api';
import {INITIAL_PRICE_STATE, PricePoller, type PriceState} from './poller';

/**
 * App-level price store. Exactly one PricePoller exists per browser tab; components
 * select from it by canonical asset ID and never issue their own `/snapshot` requests.
 */
const PollerContext = createContext<PricePoller | null>(null);

export function PriceProvider({children}: {children: ReactNode}) {
  const [poller] = useState(() => new PricePoller({client: api}));
  useEffect(() => {
    poller.start();
    return () => poller.stop();
  }, [poller]);
  return <PollerContext.Provider value={poller}>{children}</PollerContext.Provider>;
}

function usePoller(): PricePoller {
  const poller = useContext(PollerContext);
  if (!poller) throw Error('PriceProvider missing');
  return poller;
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
