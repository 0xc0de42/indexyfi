'use client';
import {createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode} from 'react';
import {cmcApi, type CmcMapping, type CmcQuoteRow} from './cmc-api';
import {CmcPoller, INITIAL_CMC_STATE, type CmcState} from './cmc-poller';

/**
 * App-level CMC store: one quote poller per tab. Mounted beside the Atlas PriceProvider
 * and outside the app loader, so CMC never delays rendering, Atlas charts or wallet actions.
 */
const CmcContext = createContext<{poller: CmcPoller} | null>(null);

export function CmcProvider({children}: {children: ReactNode}) {
  const [value] = useState(() => ({poller: new CmcPoller({client: cmcApi})}));
  useEffect(() => {
    value.poller.start();
    return () => value.poller.stop();
  }, [value]);
  return <CmcContext.Provider value={value}>{children}</CmcContext.Provider>;
}

function useCmcStores() {
  const stores = useContext(CmcContext);
  if (!stores) throw Error('CmcProvider missing');
  return stores;
}

const serverState = () => INITIAL_CMC_STATE;
export function useCmcState(): CmcState {
  const {poller} = useCmcStores();
  return useSyncExternalStore(poller.subscribe, poller.getState, serverState);
}

export function useCmcRow(assetId: string): {row: CmcQuoteRow | undefined; mapping: CmcMapping | undefined} {
  const state = useCmcState();
  return {row: state.rows.get(assetId), mapping: state.mappings.get(assetId) ?? state.rows.get(assetId)?.mapping ?? undefined};
}
