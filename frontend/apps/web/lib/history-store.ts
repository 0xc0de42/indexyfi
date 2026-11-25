import type {ApiClient, ApiError, PriceSnapshot} from './api';
import {mergeSeries, trimToWindow, type SeriesPoint} from './history';

/**
 * Client-side history for every reference asset, shared by all charts.
 *
 * At start it preloads the last 24 h of persisted minute closes (all assets) in
 * sequential 1 h chunks, newest first, so each request stays cheap for the backend.
 * Afterwards it appends every live snapshot from the poller and, once per minute,
 * fetches newly persisted closes (with a small overlap so a close written after a
 * request is never skipped). Charts derive any window up to 24 h without requests.
 */
export const HISTORY_SPAN_MS = 24 * 60 * 60_000;
export const CHUNK_MS = 60 * 60_000;
export const CHUNKS = HISTORY_SPAN_MS / CHUNK_MS;
/** 1 s samples kept per asset; older ones are represented by minute closes. */
export const LIVE_KEEP_MS = 15 * 60_000;
const CHUNK_PAUSE_MS = 100;
const REFRESH_AFTER_BOUNDARY_MS = 3_000;
const REFRESH_OVERLAP_MS = 2 * 60_000;

export interface HistoryProgress {
  readonly chunksDone: number;
  readonly chunksTotal: number;
  /** Covered span back from the preload start, ms. */
  readonly coveredMs: number;
  readonly done: boolean;
  readonly error: ApiError | null;
}

export interface HistoryStoreOptions {
  readonly client: Pick<ApiClient, 'history'>;
  readonly now?: () => number;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

export class HistoryStore {
  private readonly closes = new Map<string, Map<number, SeriesPoint>>();
  private readonly live = new Map<string, SeriesPoint[]>();
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private version = 0;
  private clock = 0;
  private progress: HistoryProgress = {chunksDone: 0, chunksTotal: CHUNKS, coveredMs: 0, done: false, error: null};
  private bootEnd: number | null = null;
  private refreshedTo: number | null = null;
  private running = false;
  private generation = 0;
  private timer: unknown = null;
  private controller: AbortController | null = null;
  /** `/history` requests issued; exposed for tests and diagnostics. */
  requests = 0;

  constructor(private readonly options: HistoryStoreOptions) {
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getVersion = (): number => this.version;
  getProgress = (): HistoryProgress => this.progress;
  /** Browser time of the last change; charts use it as "now" for their window. */
  getClock = (): number => this.clock;

  /** Start or resume the preload; restartable after stop(). */
  start(): void {
    if (this.running) return;
    this.running = true;
    const generation = ++this.generation;
    this.bootEnd ??= this.now();
    this.refreshedTo ??= this.bootEnd;
    void this.preload(generation);
  }

  stop(): void {
    this.running = false;
    this.generation++;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.controller?.abort();
    this.controller = null;
  }

  /** Retry after a failed preload chunk. */
  retry(): void {
    if (!this.progress.error) return;
    this.setProgress({...this.progress, error: null});
    this.stop();
    this.start();
  }

  addSnapshot(snapshot: PriceSnapshot): void {
    if (!Number.isFinite(snapshot.snapshotAtMs)) return;
    const cutoff = snapshot.snapshotAtMs - LIVE_KEEP_MS;
    for (const price of snapshot.prices) {
      const buffer = this.live.get(price.assetId) ?? [];
      const last = buffer.at(-1);
      if (last && last.t === snapshot.snapshotAtMs) continue;
      buffer.push({t: snapshot.snapshotAtMs, price: price.price, sourceTimestamp: price.sourceTimestamp, origin: 'live'});
      let drop = 0;
      while (drop < buffer.length && buffer[drop].t < cutoff) drop++;
      if (drop) buffer.splice(0, drop);
      this.live.set(price.assetId, buffer);
    }
    this.bump();
  }

  series(assetId: string, now: number, windowMs: number): SeriesPoint[] {
    const closes = [...(this.closes.get(assetId)?.values() ?? [])];
    return trimToWindow(mergeSeries(closes, this.live.get(assetId) ?? []), now, Math.min(windowMs, HISTORY_SPAN_MS));
  }

  // ---- internals -----------------------------------------------------------

  private bump(): void {
    this.version++;
    this.clock = this.now();
    for (const listener of this.listeners) listener();
  }

  private setProgress(progress: HistoryProgress): void {
    this.progress = progress;
    this.bump();
  }

  private addCloses(snapshots: readonly PriceSnapshot[]): void {
    const cutoff = this.now() - HISTORY_SPAN_MS - CHUNK_MS;
    for (const snapshot of snapshots) {
      if (!Number.isFinite(snapshot.snapshotAtMs)) continue;
      for (const price of snapshot.prices) {
        let byTime = this.closes.get(price.assetId);
        if (!byTime) this.closes.set(price.assetId, (byTime = new Map()));
        byTime.set(snapshot.snapshotAtMs, {t: snapshot.snapshotAtMs, price: price.price, sourceTimestamp: price.sourceTimestamp, origin: 'history'});
      }
    }
    for (const byTime of this.closes.values()) for (const t of byTime.keys()) if (t < cutoff) byTime.delete(t);
  }

  private async fetch(generation: number, start: number, end: number) {
    const controller = new AbortController();
    this.controller = controller;
    this.requests++;
    const result = await this.options.client.history({start: new Date(start), end: new Date(end)}, controller.signal);
    if (generation !== this.generation || !this.running) return null;
    this.controller = null;
    return result;
  }

  private wait(generation: number, ms: number): Promise<boolean> {
    return new Promise(resolve => {
      this.timer = this.setTimer(() => {
        this.timer = null;
        resolve(generation === this.generation && this.running);
      }, ms);
    });
  }

  private async preload(generation: number): Promise<void> {
    const bootEnd = this.bootEnd!;
    while (this.progress.chunksDone < CHUNKS) {
      const i = this.progress.chunksDone;
      const end = bootEnd - i * CHUNK_MS;
      const result = await this.fetch(generation, end - CHUNK_MS, end);
      if (!result) return;
      if (!result.ok) {
        if (result.error.kind !== 'aborted') this.setProgress({...this.progress, error: result.error});
        return;
      }
      this.addCloses(result.value);
      const chunksDone = i + 1;
      this.setProgress({chunksDone, chunksTotal: CHUNKS, coveredMs: chunksDone * CHUNK_MS, done: chunksDone === CHUNKS, error: null});
      if (chunksDone < CHUNKS && !(await this.wait(generation, CHUNK_PAUSE_MS))) return;
    }
    void this.refreshLoop(generation);
  }

  private async refreshLoop(generation: number): Promise<void> {
    for (;;) {
      const now = this.now();
      const nextBoundary = (Math.floor(now / 60_000) + 1) * 60_000;
      if (!(await this.wait(generation, nextBoundary - now + REFRESH_AFTER_BOUNDARY_MS))) return;
      const end = this.now();
      const start = Math.max(this.refreshedTo! - REFRESH_OVERLAP_MS, end - HISTORY_SPAN_MS);
      const result = await this.fetch(generation, start, end);
      if (!result) return;
      if (result.ok) {
        this.addCloses(result.value);
        this.refreshedTo = end;
        this.bump();
      }
      // On failure keep refreshedTo; the next minute's request covers the gap.
    }
  }
}
