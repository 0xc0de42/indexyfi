import {describe, expect, it} from 'vitest';
import {applyPriceMessage, initialPriceState, isStale, reconnectDelay, subscribeMessage} from './prices';

const feeds = new Set([632, 647]);
const frame = (prices: object[]) => JSON.stringify({type: 'prices', prices});

describe('price stream messages', () => {
  it('merges prices for subscribed feeds and goes live', () => {
    const state = applyPriceMessage(
      initialPriceState('ws://test'),
      frame([{feedId: 632, price: 1659.42, timestamp: 100, consensusStatus: 'HEALTHY'}, {feedId: 999, price: 1, timestamp: 100}]),
      feeds,
      5_000,
    );
    expect(state.status).toBe('live');
    expect(state.prices[632]).toMatchObject({price: 1659.42, timestamp: 100, consensusStatus: 'HEALTHY', receivedAt: 5_000});
    expect(state.prices[999]).toBeUndefined();
  });

  it('accepts string-encoded numbers and partial updates', () => {
    let state = applyPriceMessage(initialPriceState('ws://test'), frame([{feedId: '632', price: '1.5', timestamp: '10'}]), feeds);
    state = applyPriceMessage(state, frame([{feedId: 647, price: 0.9988, timestamp: 11}]), feeds);
    expect(Object.keys(state.prices).map(Number).sort()).toEqual([632, 647]);
    expect(state.prices[632].price).toBe(1.5);
  });

  it('ignores out-of-order prices', () => {
    let state = applyPriceMessage(initialPriceState('ws://test'), frame([{feedId: 632, price: 2, timestamp: 20}]), feeds);
    state = applyPriceMessage(state, frame([{feedId: 632, price: 1, timestamp: 19}]), feeds);
    expect(state.prices[632].price).toBe(2);
  });

  it('keeps prices on malformed and error frames', () => {
    const live = applyPriceMessage(initialPriceState('ws://test'), frame([{feedId: 632, price: 2, timestamp: 20}]), feeds);
    expect(applyPriceMessage(live, 'not json', feeds)).toMatchObject({error: 'Malformed price message', prices: live.prices});
    expect(applyPriceMessage(live, frame([{feedId: 632, price: -1, timestamp: 1}]), feeds).prices).toBe(live.prices);
    expect(applyPriceMessage(live, JSON.stringify({type: 'error', message: 'Atlas down'}), feeds)).toMatchObject({error: 'Atlas down', prices: live.prices});
  });

  it('flags stale prices, backs off reconnects and builds subscriptions', () => {
    const price = {feedId: 632, price: 1, timestamp: 100, receivedAt: 0};
    expect(isStale(price, 105_000)).toBe(false);
    expect(isStale(price, 111_000)).toBe(true);
    expect(isStale(undefined)).toBe(true);
    expect([0, 1, 2, 10].map(reconnectDelay)).toEqual([1_000, 2_000, 4_000, 30_000]);
    expect(JSON.parse(subscribeMessage([632, 647]))).toEqual({type: 'subscribe', feedIds: [632, 647]});
    expect(initialPriceState('').status).toBe('disabled');
  });
});
