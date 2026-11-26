/**
 * Demo: rebalancing and index settings chosen at launch, kept with each portfolio in this browser so its page can show
 * the product vision. The contracts do not store or enforce them yet (docs/rebalancing/IMPLEMENTATION_PLAN.md, vault 5.2).
 * The five demo baskets carry preset settings so the showcase works on them from the start.
 */
import type {Draft} from '@/domain/model';
import {isValidRebalance} from './rebalance';
import {DEFAULT_INDEX_RULE, isValidIndexRule} from './index-rule';
import {referenceCategories} from './catalog';

export interface PortfolioSettings {
  readonly rebalance: Draft['rebalance'];
  readonly index: Draft['index'];
  /** 'launch' when chosen in this browser's Create flow, 'demo' for the preset demo baskets. */
  readonly source: 'launch' | 'demo';
}
const KEY = 'indexfi-portfolio-settings';
const manual = DEFAULT_INDEX_RULE;

/** Preset demo settings by basket symbol (vision showcase; not on chain). */
export const DEMO_SETTINGS: Readonly<Record<string, Omit<PortfolioSettings, 'source'>>> = {
  CORE14: {rebalance: {intervalSeconds: 86_400, thresholdBps: 100}, index: manual},
  DEFI13: {rebalance: {intervalSeconds: 3_600, thresholdBps: 10}, index: manual},
  YIELD13: {rebalance: {intervalSeconds: 604_800, thresholdBps: 300}, index: manual},
  TECH13: {rebalance: {intervalSeconds: 86_400, thresholdBps: 100}, index: {kind: 'topCap', universe: 'Tokenized equity', size: 10, weighting: 'cap', maxWeightBps: 2_500}},
  MKT13: {rebalance: {intervalSeconds: 259_200, thresholdBps: 500}, index: manual},
  // Flap demo portfolio (launched by contracts/openfour/scripts/flap-full-cycle.cjs).
  IFDEMO: {rebalance: {intervalSeconds: 3_600, thresholdBps: 10}, index: manual},
};

function readAll(): Record<string, Omit<PortfolioSettings, 'source'>> {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, Omit<PortfolioSettings, 'source'>>) : {};
  } catch {
    return {};
  }
}

/** Remember the settings chosen when this browser launched `vault`. */
export function savePortfolioSettings(vault: string, settings: Omit<PortfolioSettings, 'source'>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({...readAll(), [vault.toLowerCase()]: settings}));
  } catch { /* storage unavailable: the page falls back to demo presets */ }
}

/** Settings for a portfolio: launched here, else the demo preset for its symbol, else none. */
export function portfolioSettings(vault: string, symbol: string): PortfolioSettings | null {
  const saved = readAll()[vault.toLowerCase()];
  if (saved && isValidRebalance(saved.rebalance) && isValidIndexRule(saved.index, referenceCategories)) return {...saved, source: 'launch'};
  const demo = DEMO_SETTINGS[symbol];
  return demo ? {...demo, source: 'demo'} : null;
}
