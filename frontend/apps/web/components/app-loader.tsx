'use client';
import {useEffect, useState, useSyncExternalStore, type ReactNode} from 'react';
import {referenceAssets} from '@/lib/catalog';
import {useHistoryStore, usePriceState} from '@/lib/prices';
import {CHUNKS, type HistoryProgress} from '@/lib/history-store';

/**
 * Start-up loader. It is part of the server HTML, so it is visible on first paint,
 * while the app renders underneath (inert) and warms what the first screen needs:
 * the first complete price snapshot, all token logos and 24 h of history for every
 * asset (so every chart window renders instantly).
 * It never blocks indefinitely: Skip appears after a few seconds and Continue on
 * failure. Shown once per page load.
 */
const MIN_VISIBLE_MS = 900;
const SKIP_AFTER_MS = 4_000;
const EXIT_MS = 450;
const TOTAL = referenceAssets.length;

type Phase = 'loading' | 'leaving' | 'done';
const serverProgress: HistoryProgress = {chunksDone: 0, chunksTotal: CHUNKS, coveredMs: 0, done: false, error: null};

export function AppLoader({children}: {children: ReactNode}) {
  const prices = usePriceState();
  const store = useHistoryStore();
  const progressOfHistory = useSyncExternalStore(store.subscribe, store.getProgress, () => serverProgress);
  const [phase, setPhase] = useState<Phase>('loading');
  const [logosSettled, setLogosSettled] = useState(0);
  const [minElapsed, setMinElapsed] = useState(false);
  const [canSkip, setCanSkip] = useState(false);

  useEffect(() => {
    const min = setTimeout(() => setMinElapsed(true), MIN_VISIBLE_MS);
    const skip = setTimeout(() => setCanSkip(true), SKIP_AFTER_MS);
    return () => {
      clearTimeout(min);
      clearTimeout(skip);
    };
  }, []);

  // Warm the browser cache with every token logo.
  useEffect(() => {
    let cancelled = false;
    const images = referenceAssets.map(asset => {
      const image = new Image();
      image.onload = image.onerror = () => {
        if (!cancelled) setLogosSettled(n => n + 1);
      };
      image.src = asset.logoPath;
      return image;
    });
    return () => {
      cancelled = true;
      for (const image of images) image.onload = image.onerror = null;
    };
  }, []);

  const priced = referenceAssets.filter(asset => prices.byAsset.has(asset.id)).length;
  const pricesReady = prices.status === 'ok' && priced >= TOTAL;
  const apiDown = prices.status === 'unreachable' || prices.status === 'error';
  const historyFailed = progressOfHistory.error !== null;
  const historyDone = progressOfHistory.done || historyFailed;
  const failed = apiDown || historyFailed;
  const ready = pricesReady && logosSettled >= TOTAL && historyDone;
  const progress = Math.round(((priced + logosSettled) / (2 * TOTAL)) * 50 + (historyDone ? 50 : (progressOfHistory.chunksDone / progressOfHistory.chunksTotal) * 50));
  const status = apiDown
    ? 'Price API unreachable · retrying'
    : prices.status === 'not_initialized'
      ? 'Price server is starting up'
      : !pricesReady
        ? `Loading reference prices · ${priced} / ${TOTAL}`
        : historyFailed
          ? 'History unavailable · charts show live samples'
          : !historyDone
            ? `Loading history · ${progressOfHistory.chunksDone} / ${progressOfHistory.chunksTotal} h`
            : 'Ready';

  useEffect(() => {
    if (phase === 'loading' && ready && minElapsed) setPhase('leaving');
  }, [phase, ready, minElapsed]);
  useEffect(() => {
    if (phase !== 'leaving') return;
    const id = setTimeout(() => setPhase('done'), EXIT_MS);
    return () => clearTimeout(id);
  }, [phase]);

  return (
    <>
      {phase !== 'done' && (
        <div className={`boot${phase === 'leaving' ? ' boot--leaving' : ''}`} role="dialog" aria-modal="true" aria-label="Loading IndexFi">
          <div className="boot__figure" aria-hidden="true">
            <div className="boot__spin"><i /><i /><i /></div>
          </div>
          <strong className="boot__name">IndexFi</strong>
          <div className="boot__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Loading progress">
            <span style={{width: `${progress}%`}} />
          </div>
          <p className={`boot__status${failed ? ' boot__status--bad' : ''}`} aria-live="polite">{status}</p>
          <button type="button" className="text-button boot__skip" hidden={!(canSkip || failed)} onClick={() => setPhase('leaving')}>
            {failed ? 'Continue anyway' : 'Skip'}
          </button>
        </div>
      )}
      <div className="boot-content" inert={phase !== 'done'}>
        {children}
      </div>
    </>
  );
}
