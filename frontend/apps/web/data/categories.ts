/**
 * Display categories for the reference registry, keyed by canonical asset id (never by ticker).
 * The generated registry tags 63 assets "Crypto" and 3 "LST"; these overrides label tokenized equities, ETFs
 * (including leveraged and inverse ones), stablecoins and liquid staking tokens from each asset's name.
 * Unlisted assets fall back to the generated category. Labels only; they say nothing about backing.
 */
export const ASSET_CATEGORIES = ['Crypto', 'Tokenized equity', 'ETF', 'Stablecoin', 'LST'] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const CATEGORY_OVERRIDES: Readonly<Record<string, AssetCategory>> = {
  '56:0x93862d63fd9fd488b1328e9b47717d75e994a84b': 'ETF', // DRAMB · Roundhill Memory ETF
  '56:0xbe82f76637dba2c114c41df856c2c51e522e2cb8': 'ETF', // EWYB · iShares MSCI South Korea ETF
  '56:0x205812cdbed920aff76c6580abd681a46d11efc7': 'ETF', // QQQB · Invesqo QQQ
  '56:0xd97d097a89113fa59b76c572e5b2eb647e8eefaf': 'ETF', // SOXLB · Semicon Bull 3X ETF
  '56:0x7138b48df7d98d7e3cc221bfe7192d0a178182d8': 'ETF', // SPYB · SPY
  '56:0x25e572b466d152604d9e6c3e53b432b978825342': 'ETF', // SQQQB · ProShares UltraPro Short QQQ
  '56:0x75fd4cf6f8392e41e70391d60c90c0d5211603a1': 'Tokenized equity', // AMDB · Advanced Micro Devices Inc
  '56:0x38dd26788cf2d901e3abf04efe3007d459d0fc53': 'Tokenized equity', // ANTB · Anthropic
  '56:0xe81c6bb0266cd68b4f17278531dd03ea1f12da4e': 'Tokenized equity', // CBRSB · Cerebras
  '56:0x585bde7c54abb5ccd7791f923d6c2187635f3952': 'Tokenized equity', // COINB · Coinbase
  '56:0x740e075cbbea22a082b9d6679e65e82767875b6a': 'Tokenized equity', // GLWB · Corning
  '56:0x3f53de71c126bdabae20f9cd64848d317f6c3238': 'Tokenized equity', // GOOGLB · Alphabet
  '56:0xe614e2fc6c787035ff51f452e8e826bfd32d5283': 'Tokenized equity', // INTCB · Intel Corporation
  '56:0x64748bea17b6d19e242adf20425de2440c656142': 'Tokenized equity', // LITEB · Lumentum Holdings
  '56:0x7425889fe94f9d693e8daefe88bcced6acfef4c0': 'Tokenized equity', // METAB · Meta Platforms
  '56:0x80106cb3ead06659a5ad19df39d9b4733863b9b0': 'Tokenized equity', // MSFTB · Microsoft
  '56:0xe87afb3076aeb0f9b14e368de8145ae6a2826a14': 'Tokenized equity', // MSTRB · Strategy Inc.
  '56:0xe256bc2a4f5297f8ba6f043f180a46300ecbcbb1': 'Tokenized equity', // NBISB · Nebius
  '56:0x0ca5d51d0277bd006fd9607d3e560785ebad8222': 'Tokenized equity', // PLTRB · Palantir Technologies
  '56:0x5f7a56e877b9130608bf8be962621011182fefe1': 'Tokenized equity', // QCOMB · Qualcomm
  '56:0xebe29695f8047c13d36e7a790ca8c1b239ffad1c': 'Tokenized equity', // WDCB · Western Digital
  '56:0xe9e7cea3dedca5984780bafc599bd69add087d56': 'Stablecoin', // BUSD · Binance Pegged BUSD
  '56:0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3': 'Stablecoin', // DAI · Binance Pegged DAI
  '56:0xc5f0f7b66764f6ec8c8dff7ba683102295e16409': 'Stablecoin', // FDUSD · First Digital USD
  '56:0x40af3827f39d0eacbf4a168f8d4ee67c121d11c9': 'Stablecoin', // TUSD · TrueUSD
  '56:0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d': 'Stablecoin', // USD1 · World Liberty Financial USD
  '56:0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34': 'Stablecoin', // USDe · USDe
  '56:0x55d398326f99059ff775485246999027b3197955': 'Stablecoin', // USDT · Binance Pegged USDT
  '56:0x4bd17003473389a42daf6a0a729f6fdb328bbbd7': 'Stablecoin', // VAI · VAI Stablecoin
  '56:0xf81ac2e1a0373dde1bce01e2fe694a9b7e3bfcb9': 'Stablecoin', // XUSD · XUSD
  '56:0xa2e3356610840701bdf5611a53974510ae27e2e1': 'LST', // wBETH · Wrapped Binance Beacon ETH
  '56:0xb0b84d294e0c75a6abe60171b70edeb2efd14a1b': 'LST', // slisBNB · Staked Lista BNB
};
