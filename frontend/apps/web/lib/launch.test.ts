import {describe, expect, it} from 'vitest';
import {LAUNCH, launchTotalUSDT, unlockMilestone} from './launch';

describe('fixed launch parameters', () => {
  it('uses 1,000 collateral, $1 NAV and a $10,000 trading unlock milestone', () => {
    expect(LAUNCH.collateralUSDT).toBe(1_000);
    expect(LAUNCH.startNav).toBe(1);
    expect(LAUNCH.tradingUnlockUSD).toBe(10_000);
    expect(launchTotalUSDT).toBe(LAUNCH.collateralUSDT + LAUNCH.poolReserveUSDT);
  });
  it('reaches the milestone at the threshold, caps progress and treats unknown AUM as not reached', () => {
    expect(unlockMilestone(1_000)).toEqual({reached: false, progressPct: 10});
    expect(unlockMilestone(9_999.99).reached).toBe(false);
    expect(unlockMilestone(10_000)).toEqual({reached: true, progressPct: 100});
    expect(unlockMilestone(25_000).progressPct).toBe(100);
    expect(unlockMilestone(null)).toEqual({reached: false, progressPct: 0});
    expect(unlockMilestone(Number.NaN).reached).toBe(false);
  });
});
