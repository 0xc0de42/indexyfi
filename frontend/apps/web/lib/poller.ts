import type {ApiClient, ApiError, AssetPrice, PriceSnapshot} from './api';

/**
 * The single app-level `/snapshot` poller: immediate fetch, then one request per
 * interval, never overlapping. A failed poll keeps the last good snapshot. No
 * staleness rejection, timestamp ordering or circuit breaker: the backend is
 * last-arrival-wins and never expires prices. An HTTP 200 is not proof that the
 * backend is still connected to Atlas.
 */
export type PriceStatus = 'idle' | 'loading' | 'ok' | 'not_initialized' | 'unreachable' | 'error';

export interface PriceState {
  readonly status: PriceStatus;
  readonly snapshot: PriceSnapshot | null;
  readonly byAsset: ReadonlyMap<string, AssetPrice>;
  readonly error: ApiError | null;
  /** Browser time of the last successful poll. */
  readonly lastSuccessAt: number | null;
}

export const INITIAL_PRICE_STATE: PriceState = {status: 'idle', snapshot: null, byAsset: new Map(), error: null, lastSuccessAt: null};

export interface PollerOptions {
  readonly client: Pick<ApiClient, 'snapshot'>;
  readonly intervalMs?: number;
  readonly now?: () => number;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

export class PricePoller {
  private state: PriceState = INITIAL_PRICE_STATE;
  private readonly listeners = new Set<() => void>();
  private readonly snapshotListeners = new Set<(snapshot: PriceSnapshot) => void>();
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private running = false;
  private generation = 0;
  private timer: unknown = null;
  private controller: AbortController | null = null;
  /** Number of `/snapshot` requests issued; exposed for tests and diagnostics. */
  requests = 0;

  constructor(private readonly options: PollerOptions) {
    this.intervalMs = options.intervalMs ?? 1_000;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  getState = (): PriceState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Called once per successfully decoded snapshot, after the state update. */
  onSnapshot = (listener: (snapshot: PriceSnapshot) => void): (() => void) => {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    const generation = ++this.generation;
    if (this.state.status === 'idle') this.set({...this.state, status: 'loading'});
    void this.poll(generation);
  }

  stop(): void {
    this.running = false;
    this.generation++;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.controller?.abort();
    this.controller = null;
  }

  private set(next: PriceState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  private async poll(generation: number): Promise<void> {
    this.timer = null;
    const controller = new AbortController();
    this.controller = controller;
    const started = this.now();
    this.requests++;
    const result = await this.options.client.snapshot(controller.signal);
    // Stopped or restarted while in flight: a newer generation owns the state.
    if (generation !== this.generation || !this.running) return;
    this.controller = null;
    if (result.ok) {
      const snapshot = result.value;
      this.set({
        status: 'ok',
        snapshot,
        byAsset: new Map(snapshot.prices.map(price => [price.assetId, price])),
        error: null,
        lastSuccessAt: this.now(),
      });
      for (const listener of this.snapshotListeners) listener(snapshot);
    } else if (result.error.kind !== 'aborted') {
      const status: PriceStatus =
        result.error.kind === 'not_initialized' ? 'not_initialized' : result.error.kind === 'unreachable' ? 'unreachable' : 'error';
      this.set({...this.state, status, error: result.error});
    }
    const delay = Math.max(0, this.intervalMs - (this.now() - started));
    this.timer = this.setTimer(() => void this.poll(generation), delay);
  }
}
