import type {ApiClient, PriceSnapshot, Result} from './api';

/** Window prefetched once at application start. */
export const BOOT_HISTORY_MS = 5 * 60_000;

const minuteOf = (ms: number) => Math.floor(ms / 60_000);

/**
 * One `/history` request for the last five minutes (all assets), made at
 * application start so the first chart renders without its own request.
 *
 * A chart may reuse it only within the same UTC minute as the request: minute
 * closes are persisted at minute boundaries, so until the next boundary a fresh
 * request could not return anything newer. After that, charts fetch normally.
 */
export class RecentHistoryCache {
  private entry: {readonly end: number; readonly promise: Promise<Result<readonly PriceSnapshot[]>>} | null = null;

  constructor(
    private readonly client: Pick<ApiClient, 'history'>,
    private readonly now: () => number = Date.now,
  ) {}

  /** Starts the boot request once; later calls return the same promise. */
  prefetch(): Promise<Result<readonly PriceSnapshot[]>> {
    if (!this.entry) {
      const end = this.now();
      this.entry = {end, promise: this.client.history({start: new Date(end - BOOT_HISTORY_MS), end: new Date(end)})};
    }
    return this.entry.promise;
  }

  /**
   * Snapshots that can serve a chart window of `windowMs` ending now, or null when
   * the chart must request its own history. Resolves to null if the boot request failed.
   */
  usable(windowMs: number): Promise<readonly PriceSnapshot[] | null> | null {
    if (windowMs > BOOT_HISTORY_MS) return null;
    const promise = this.prefetch();
    if (minuteOf(this.now()) !== minuteOf(this.entry!.end)) return null;
    return promise.then(result => (result.ok ? result.value : null));
  }
}
