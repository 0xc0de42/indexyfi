'use client';
import {Badge} from '@indexfi/ui';
import {describeApiError} from '@/lib/api';
import type {PriceState} from '@/lib/poller';

/**
 * Factual availability of the IndexFi price API. A 200 only means the server answered;
 * it is not proof that the server is still connected to Atlas.
 */
export function apiStatusText(state: PriceState): {tone: 'good' | 'warn' | 'bad' | 'neutral'; label: string; detail: string | null} {
  switch (state.status) {
    case 'idle':
    case 'loading':
      return {tone: 'neutral', label: 'Contacting price API…', detail: null};
    case 'ok':
      return {tone: 'good', label: 'Price API responding', detail: null};
    case 'not_initialized':
      return {tone: 'warn', label: 'Price API initializing', detail: describeApiError({kind: 'not_initialized'})};
    case 'unreachable':
      return {tone: 'bad', label: 'Price API unreachable', detail: state.snapshot ? 'Showing the last received snapshot.' : null};
    case 'error':
      return {
        tone: 'bad',
        label: 'Price API error',
        detail: `${state.error ? describeApiError(state.error) : ''}${state.snapshot ? ' Showing the last received snapshot.' : ''}`.trim(),
      };
  }
}

export function ApiStatusBadge({state}: {state: PriceState}) {
  const status = apiStatusText(state);
  return <Badge tone={status.tone}>{status.label}</Badge>;
}
