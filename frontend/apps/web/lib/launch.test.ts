import {describe, expect, it} from 'vitest';
import {graduation, LAUNCH, launchTotalUSDT} from './launch';

describe('fixed launch parameters', () => {
  it('uses 1,000 USDT collateral, $1 NAV and a 10,000 USDT graduation threshold', () => {
    expect(LAUNCH.collateralUSDT).toBe(1_000);
    expect(LAUNCH.startNav).toBe(1);
    expect(LAUNCH.graduationUSD).toBe(10_000);
    expect(launchTotalUSDT).toBe(LAUNCH.collateralUSDT + LAUNCH.poolReserveUSDT);
  });
  it('graduates at the threshold, caps progress and treats unknown AUM as pre-graduation', () => {
    expect(graduation(1_000)).toEqual({graduated: false, progressPct: 10});
    expect(graduation(9_999.99).graduated).toBe(false);
    expect(graduation(10_000)).toEqual({graduated: true, progressPct: 100});
    expect(graduation(25_000).progressPct).toBe(100);
    expect(graduation(null)).toEqual({graduated: false, progressPct: 0});
    expect(graduation(Number.NaN).graduated).toBe(false);
  });
});
