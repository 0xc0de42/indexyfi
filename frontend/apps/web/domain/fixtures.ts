import type {Asset, Portfolio} from './model';
import {referenceAssetById} from '@/lib/catalog';

/**
 * Fixture portfolios for layout until contract integration (Phase III). Constituents
 * are real registry assets referenced by canonical ID; every financial value below
 * is illustrative and labelled as a fixture in the UI.
 */
const ID = {
  BTCB: '56:0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c',
  ETH: '56:0x2170ed0880ac9a755fd29b2688956bd959f933f8',
  SOL: '56:0x570a5d26f7765ecb712c0924e4de545b89fd43df',
  CAKE: '56:0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
  XVS: '56:0xcf6bb5389c92bdda8a3747ddb454cb7a64626c63',
  LINK: '56:0xf8a0bf9cf54bb92f17374d9e9a321e6a111a51bd',
  USDT: '56:0x55d398326f99059ff775485246999027b3197955',
  DAI: '56:0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3',
  FDUSD: '56:0xc5f0f7b66764f6ec8c8dff7ba683102295e16409',
} as const;

function asset(id: string): Asset {
  const found = referenceAssetById(id);
  if (!found) throw Error(`Fixture constituent ${id} is not in the verified registry`);
  return found;
}

function make(
  id: string,
  name: string,
  symbol: string,
  description: string,
  category: string,
  allocations: [string, number][],
  price: number,
  aum: number,
  progress: number,
  return30d: number,
): Portfolio {
  return {
    id,
    name,
    symbol,
    description,
    category,
    allocations: allocations.map(([assetId, weight]) => ({asset: asset(assetId), weight})),
    source: 'fixture',
    reference: price,
    marketPrice: price * 1.002,
    return30d,
    volume: aum * 0.11,
    liquidity: aum * 0.1,
    aum,
    supply: aum / price,
    creator: null,
    createdAt: '2026-11-25T08:00:00Z',
    phase: progress === 100 ? 'graduated' : 'launch',
    progress,
    creatorFeeBps: 50,
    venue: progress === 100 ? 'PancakeSwap' : 'OpenFour',
    paused: false,
  };
}

export const portfolios: readonly Portfolio[] = [
  make('blue', 'Crypto Leaders', 'BLUE', 'A fixed basket of major digital assets.', 'Crypto', [[ID.BTCB, 50], [ID.ETH, 30], [ID.SOL, 20]], 1.24, 12400, 62, 8.4),
  make('ecosystem', 'BNB DeFi', 'BDFI', 'Hold DeFi assets native to BNB Chain.', 'DeFi', [[ID.CAKE, 50], [ID.XVS, 30], [ID.LINK, 20]], 0.96, 8700, 100, -2.1),
  make('stable', 'Stable Reserve', 'STBL', 'A simple dollar-stablecoin allocation.', 'Stablecoins', [[ID.USDT, 40], [ID.DAI, 30], [ID.FDUSD, 30]], 1.001, 6500, 34, 0.1),
];

export const portfolioById = (id: string) => portfolios.find(p => p.id === id) ?? null;
