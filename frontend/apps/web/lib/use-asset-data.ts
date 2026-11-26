'use client';
import {useCallback, useMemo, useSyncExternalStore} from 'react';
import type {Asset} from '@/domain/model';
import type {AssetData} from './asset-query';
import {useCmcState} from './cmc';
import {useHistoryStore, usePriceState} from './prices';
import {CHUNKS, type HistoryProgress} from './history-store';

const DAY = 24 * 60 * 60_000;
const MIN_SPAN = 60 * 60_000;
const zero = () => 0;
const serverProgress: HistoryProgress = {chunksDone: 0, chunksTotal: CHUNKS, coveredMs: 0, done: false, error: null};

/**
 * Per-asset Atlas and CMC data for filtering and sorting. The Atlas change comes from the app's preloaded history store:
 * first stored observation within the last 24 h vs the latest one, so it covers however much history the server holds
 * (reported as atlasSpanMs, at least 1 h). Recomputed once per minute; it adds no requests.
 */
export function useAssetData(assets: readonly Asset[]): (asset: Asset) => AssetData {
  const prices = usePriceState();
  const cmc = useCmcState();
  const history = useHistoryStore();
  const clock = useSyncExternalStore(history.subscribe, history.getClock, zero);
  const minute = Math.floor(clock / 60_000);
  // Also recompute as the 24 h preload advances, not only once a minute.
  const loaded = useSyncExternalStore(history.subscribe, history.getProgress, () => serverProgress).chunksDone;
  const atlas = useMemo(() => {
    const out = new Map<string, {change: number; span: number}>();
    if (!minute) return out;
    const now = clock;
    for (const a of assets) {
      const s = history.series(a.id, now, DAY);
      const first = s[0], last = s[s.length - 1];
      const span = first && last ? last.t - first.t : 0;
      if (span >= MIN_SPAN && Number(first.price) > 0) out.set(a.id, {change: (Number(last.price) / Number(first.price) - 1) * 100, span});
    }
    return out;
  }, [history, assets, minute, loaded]);
  return useCallback(
    (asset: Asset) => ({price: prices.byAsset.get(asset.id)?.price, atlasChange: atlas.get(asset.id)?.change ?? null, atlasSpanMs: atlas.get(asset.id)?.span ?? null, quote: cmc.rows.get(asset.id)?.quote ?? null}),
    [prices.byAsset, cmc.rows, atlas],
  );
}
