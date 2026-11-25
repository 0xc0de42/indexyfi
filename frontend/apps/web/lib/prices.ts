import {useEffect, useState} from 'react';
import {z} from 'zod';

/**
 * Live Atlas prices streamed by the Python server over WebSocket.
 *
 * The frontend never calls Atlas directly. Protocol (JSON text frames):
 *   client → server  {"type":"subscribe","feedIds":[632,647,...]}        sent on every (re)connect
 *   server → client  {"type":"prices","prices":[{"feedId":632,"price":1659.42,
 *                     "timestamp":1795627291,"consensusStatus":"HEALTHY"}]}  full or partial update
 *   server → client  {"type":"error","message":"..."}
 * `price` is USD as a decimal number, `timestamp` is the Atlas price time in Unix seconds.
 */
export const PRICE_WS_URL = process.env.NEXT_PUBLIC_PRICE_WS_URL ?? '';
export const STALE_AFTER_SECONDS = 10;

const feedPriceSchema = z.object({
  feedId: z.coerce.number().int().positive(),
  price: z.coerce.number().positive(),
  timestamp: z.coerce.number().int().nonnegative(),
  consensusStatus: z.string().nullish(),
});
const messageSchema = z.discriminatedUnion('type', [
  z.object({type: z.literal('prices'), prices: z.array(feedPriceSchema)}),
  z.object({type: z.literal('error'), message: z.string()}),
]);

export type FeedPrice = z.infer<typeof feedPriceSchema> & {receivedAt: number};
export type PriceStatus = 'disabled' | 'connecting' | 'live' | 'reconnecting';
export type PriceState = {
  status: PriceStatus;
  prices: Readonly<Record<number, FeedPrice>>;
  error: string | null;
  lastMessageAt: number | null;
};

export const initialPriceState = (url: string = PRICE_WS_URL): PriceState => ({
  status: url ? 'connecting' : 'disabled',
  prices: {},
  error: url ? null : 'NEXT_PUBLIC_PRICE_WS_URL is not configured',
  lastMessageAt: null,
});

export const subscribeMessage = (feedIds: readonly number[]) => JSON.stringify({type: 'subscribe', feedIds});

/** Merge one server frame. Unknown feeds, malformed frames and out-of-order prices are ignored. */
export function applyPriceMessage(state: PriceState, raw: string, feedIds: ReadonlySet<number>, now = Date.now()): PriceState {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return {...state, error: 'Malformed price message'};
  }
  const parsed = messageSchema.safeParse(decoded);
  if (!parsed.success) return {...state, error: 'Unrecognised price message'};
  if (parsed.data.type === 'error') return {...state, error: parsed.data.message, lastMessageAt: now};

  const prices = {...state.prices};
  for (const update of parsed.data.prices) {
    if (!feedIds.has(update.feedId)) continue;
    const previous = prices[update.feedId];
    if (previous && previous.timestamp > update.timestamp) continue;
    prices[update.feedId] = {...update, receivedAt: now};
  }
  return {status: 'live', prices, error: null, lastMessageAt: now};
}

export const isStale = (price: FeedPrice | undefined, now = Date.now()) =>
  !price || now / 1000 - price.timestamp > STALE_AFTER_SECONDS;

export const reconnectDelay = (attempt: number) => Math.min(30_000, 1_000 * 2 ** attempt);

/** Subscribe to the given Atlas feed IDs; reconnects with exponential backoff. */
export function useLivePrices(feedIds: readonly number[], url: string = PRICE_WS_URL): PriceState {
  const [state, setState] = useState<PriceState>(() => initialPriceState(url));
  const key = feedIds.join(',');

  useEffect(() => {
    if (!url) {
      setState(initialPriceState(url));
      return;
    }
    const ids = key ? key.split(',').map(Number) : [];
    const wanted = new Set(ids);
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let closed = false;

    const connect = () => {
      setState(current => ({...current, status: attempt ? 'reconnecting' : 'connecting'}));
      socket = new WebSocket(url);
      socket.onopen = () => {
        attempt = 0;
        socket?.send(subscribeMessage(ids));
      };
      socket.onmessage = event => {
        if (typeof event.data === 'string') setState(current => applyPriceMessage(current, event.data, wanted));
      };
      socket.onclose = () => {
        if (closed) return;
        setState(current => ({...current, status: 'reconnecting', error: current.error ?? 'Price server unavailable'}));
        timer = setTimeout(connect, reconnectDelay(attempt++));
      };
    };
    connect();

    return () => {
      closed = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [key, url]);

  return state;
}

/** Re-render every `intervalMs` so ages and staleness stay current. */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
