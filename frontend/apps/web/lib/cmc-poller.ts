import type {CmcClient, CmcError, CmcMapping, CmcQuoteRow} from './cmc-api';

/**
 * The single app-level CMC poller: approved mappings once (retried until they arrive), latest quotes immediately and
 * then every 60 s, never overlapping. Independent of the Atlas poller and never gates rendering or wallet actions.
 *
 * Merge rule (per canonical asset): a valid quote replaces the previous one regardless of its timestamp; a null or
 * omitted quote never erases an earlier valid one during the session. No TTL, staleness or expiry by design.
 */
export type CmcStatus = 'idle' | 'loading' | 'ok' | 'disabled' | 'unreachable' | 'error';

export interface CmcState {
  readonly status: CmcStatus;
  readonly mappings: ReadonlyMap<string, CmcMapping>;
  /** Latest row per canonical asset id, with the last valid quote kept. */
  readonly rows: ReadonlyMap<string, CmcQuoteRow>;
  readonly error: CmcError | null;
  readonly lastSuccessAt: number | null;
}
export const INITIAL_CMC_STATE: CmcState = {status: 'idle', mappings: new Map(), rows: new Map(), error: null, lastSuccessAt: null};

export interface CmcPollerOptions {
  readonly client: Pick<CmcClient, 'assets' | 'quotes'>;
  readonly intervalMs?: number;
  readonly now?: () => number;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

/** Merge a quotes response into the previous rows (pure; exported for tests). */
export function mergeQuoteRows(previous: ReadonlyMap<string, CmcQuoteRow>, incoming: readonly CmcQuoteRow[]): Map<string, CmcQuoteRow> {
  const next = new Map(previous);
  for (const row of incoming) {
    const before = previous.get(row.assetId);
    next.set(row.assetId, row.quote ? row : {...row, quote: before?.quote ?? null});
  }
  return next;
}

export class CmcPoller {
  private state: CmcState = INITIAL_CMC_STATE;
  private readonly listeners = new Set<() => void>();
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private running = false;
  private generation = 0;
  private timer: unknown = null;
  private controller: AbortController | null = null;
  requests = 0;

  constructor(private readonly options: CmcPollerOptions) {
    this.intervalMs = options.intervalMs ?? 60_000;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  getState = (): CmcState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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

  private set(next: CmcState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  private async poll(generation: number): Promise<void> {
    this.timer = null;
    const controller = new AbortController();
    this.controller = controller;
    const started = this.now();
    // Mappings are requested until they arrive, alongside (not before) the quotes.
    const needMappings = this.state.mappings.size === 0;
    this.requests += needMappings ? 2 : 1;
    const [assets, quotes] = await Promise.all([
      needMappings ? this.options.client.assets(controller.signal) : Promise.resolve(null),
      this.options.client.quotes(undefined, controller.signal),
    ]);
    if (generation !== this.generation || !this.running) return;
    this.controller = null;
    let next = this.state;
    if (assets?.ok) next = {...next, mappings: new Map(assets.value.map(m => [m.assetId, m]))};
    if (quotes.ok) {
      const rows = mergeQuoteRows(next.rows, quotes.value);
      // Quote rows carry their mapping too, so mappings also fill in from them.
      const mappings = new Map(next.mappings);
      for (const row of quotes.value) if (row.mapping && !mappings.has(row.assetId)) mappings.set(row.assetId, row.mapping);
      next = {...next, status: 'ok', rows, mappings, error: null, lastSuccessAt: this.now()};
    } else if (quotes.error.kind !== 'aborted') {
      const status: CmcStatus = quotes.error.kind === 'cmc_disabled' ? 'disabled' : quotes.error.kind === 'unreachable' ? 'unreachable' : 'error';
      next = {...next, status, error: quotes.error};
    }
    if (next !== this.state) this.set(next);
    const delay = Math.max(0, this.intervalMs - (this.now() - started));
    this.timer = this.setTimer(() => void this.poll(generation), delay);
  }
}
