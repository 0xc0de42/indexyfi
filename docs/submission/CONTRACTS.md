# IndexFi — deployed contracts (BSC Testnet, chain 97)

Generated 2026-11-26T18:28:29.839Z by `contracts/openfour/scripts/submission-contracts.cjs` from the deployment records; every address below was checked on chain to have code. Explorer: https://testnet.bscscan.com.

IndexFi turns a basket of tokens into one collateral-backed portfolio token: deposit or redeem at NAV (signed Atlas prices), trade on PancakeSwap. Two launch venues share one vault design: an OpenFour preset and a Flap direct launch.

## 1. OpenFour launch venue

### 1.1 OpenFour core (IndexFi's fork deployment, via the official fork-deploy tool)

| Contract | Address | Notes |
|---|---|---|
| OpenFour Core | [`0x931a6354E2f76df5Bd5F35ad177EA9f215d3b57E`](https://testnet.bscscan.com/address/0x931a6354E2f76df5Bd5F35ad177EA9f215d3b57E) | launch entry point; signer = IndexFi operator |
| OpenFour Registry | [`0x5eE05e2DfF97B60d6367e13BC141Bd306e6286F2`](https://testnet.bscscan.com/address/0x5eE05e2DfF97B60d6367e13BC141Bd306e6286F2) | modules and presets |
| FeeRouter | [`0x17d89d13F873E6C105DBBDB5f33FE29Be3ec28D8`](https://testnet.bscscan.com/address/0x17d89d13F873E6C105DBBDB5f33FE29Be3ec28D8) |  |
| Tools | [`0x68F9f066fa9b91BA2f8F91133FA410F2a2a30202`](https://testnet.bscscan.com/address/0x68F9f066fa9b91BA2f8F91133FA410F2a2a30202) |  |
| Create deployer | [`0x81870540181e4CbF07BFA9F8Cca64A0a8543195e`](https://testnet.bscscan.com/address/0x81870540181e4CbF07BFA9F8Cca64A0a8543195e) |  |
| Standard token implementation | [`0xAE27264A3eCd3d152A6fa01E0860Fc12100687Fe`](https://testnet.bscscan.com/address/0xAE27264A3eCd3d152A6fa01E0860Fc12100687Fe) |  |
| Tax token implementation | [`0x2E2Ffb402ECC90A83392e345eB004afFdC5e755C`](https://testnet.bscscan.com/address/0x2E2Ffb402ECC90A83392e345eB004afFdC5e755C) |  |
| Forward vault implementation | [`0xf2171bAbC2142F192eFF889D577642ad55b44091`](https://testnet.bscscan.com/address/0xf2171bAbC2142F192eFF889D577642ad55b44091) |  |
| Tax vault registry | [`0x08477C50B5831cc22c33C8efAb8FbC97f3ec5864`](https://testnet.bscscan.com/address/0x08477C50B5831cc22c33C8efAb8FbC97f3ec5864) |  |
| Preset validator (OpenFour) | [`0xD8590b6914d4D60FcCfe08A2087B9A3d3F2d6A70`](https://testnet.bscscan.com/address/0xD8590b6914d4D60FcCfe08A2087B9A3d3F2d6A70) |  |

### 1.2 IndexFi preset on OpenFour (preset id 202611260001)

| Contract | Address | Notes |
|---|---|---|
| IndexFiFactory | [`0x2E3e3Fb3d6b47c927F091380E175116D7cF5E658`](https://testnet.bscscan.com/address/0x2E3e3Fb3d6b47c927F091380E175116D7cF5E658) | portfolio factory and directory · [tx](https://testnet.bscscan.com/tx/0x1cbbb551bfc951e2bbe1b88f6a24c658af8721ede55c1f73deb2cb951abb65e8) |
| IndexFiVault | [`0xFF0b31A065c950A196B6B36ad0F78BaFa30A1625`](https://testnet.bscscan.com/address/0xFF0b31A065c950A196B6B36ad0F78BaFa30A1625) | vault module (collateral-backed portfolio vault) · [tx](https://testnet.bscscan.com/tx/0x122179c0fbe3ae225c6b75490e0f6ea993a2df47e231ec497a2304fa31a4fb30) |
| IndexFiCurveModule | [`0x72cEEd5fBd31CfeC53b1F2f478C249CC0F15310F`](https://testnet.bscscan.com/address/0x72cEEd5fBd31CfeC53b1F2f478C249CC0F15310F) | curve module · [tx](https://testnet.bscscan.com/tx/0x4c98f96a59279dc07abd8e1eb7b6eaf8e93567276365566c38faffa78182bf48) |
| IndexFiTradeModule | [`0x442Fa6afd4E7079FA1086e97bAAaB987E2AEB4d4`](https://testnet.bscscan.com/address/0x442Fa6afd4E7079FA1086e97bAAaB987E2AEB4d4) | trade module · [tx](https://testnet.bscscan.com/tx/0x6b435f3d911e298d550fae4e7d6fd79a57063cca087b366b5363b6669863b9ac) |
| IndexFiMigrateModule | [`0x4ca1391014068082b8E7f17AA41597375Ba45682`](https://testnet.bscscan.com/address/0x4ca1391014068082b8E7f17AA41597375Ba45682) | migrate module (PancakeSwap pool at launch) · [tx](https://testnet.bscscan.com/tx/0xe71597803316b4da527ef5cfc9c08bac64377aa71bd6419229bc816d3036a3c2) |
| IndexFiPresetValidator | [`0xeBbc9f149F6253130190Ba5C1e428b8df2CE9A75`](https://testnet.bscscan.com/address/0xeBbc9f149F6253130190Ba5C1e428b8df2CE9A75) | preset validator · [tx](https://testnet.bscscan.com/tx/0x8f7c91e548dd6279fde6e7df379662455cb3dd32f47eec514a976e5082de8aed) |
| AtlasSignedOracle | [`0x9f47ecDB9737FFf804F356Fc4e8f5D09BaF0a0C7`](https://testnet.bscscan.com/address/0x9f47ecDB9737FFf804F356Fc4e8f5D09BaF0a0C7) | verifies Atlas-signed price payloads on chain · [tx](https://testnet.bscscan.com/tx/0xad2ee5839a28820784b765333a75e6642dfa31c3d61516fb34b091b681fa1310) |
| PancakeV2BasketAdapter | [`0x17d053834387B53f28c66C18C61Dac0755a7aE7f`](https://testnet.bscscan.com/address/0x17d053834387B53f28c66C18C61Dac0755a7aE7f) | PancakeSwap V2 routes for the 66 assets · [tx](https://testnet.bscscan.com/tx/0x11f85211bbf62b800df4cfa6a0cfa110ea7904aa0436d0c886492a1431d379d7) |
| Test USDT (settlement) | [`0x48FB3d62B16de656534A74fEa4BbBaEBC900EA2d`](https://testnet.bscscan.com/address/0x48FB3d62B16de656534A74fEa4BbBaEBC900EA2d) | test USDT (18 decimals, operator mint) · [tx](https://testnet.bscscan.com/tx/0xa392fac3c110a5de40983811140f680f6e55dafc831fa80ebf579a13f97b2e48) |

### 1.3 Portfolios (OpenFour)

| Contract | Address | Notes |
|---|---|---|
| Core Crypto (CORE14) — vault | [`0x876675862c2CB33Ca99D8102600580147A4b4C67`](https://testnet.bscscan.com/address/0x876675862c2CB33Ca99D8102600580147A4b4C67) | launch · [tx](https://testnet.bscscan.com/tx/0x6b72c15d1d768b01d0724c907bb6713f45f4f6d2616fd8441324f0ba5860870d) |
| CORE14 — portfolio token | [`0xd1C00d9eF5b0B05371cC581BEB30255299Ec79ff`](https://testnet.bscscan.com/address/0xd1C00d9eF5b0B05371cC581BEB30255299Ec79ff) |  |
| CORE14 — PancakeSwap pool | [`0xa7Ed45195ba9052600170b893a89420B41650ca8`](https://testnet.bscscan.com/address/0xa7Ed45195ba9052600170b893a89420B41650ca8) |  |
| DeFi & BNB (DEFI13) — vault | [`0x452155d47bd092720D7ebA745604A3e707518e55`](https://testnet.bscscan.com/address/0x452155d47bd092720D7ebA745604A3e707518e55) | launch · [tx](https://testnet.bscscan.com/tx/0x33478c4fae127dd79b940504a57bc0ab4f31dcd5fa7e30f75af711f9d0b639d2) |
| DEFI13 — portfolio token | [`0x3EC73D238BDCBc408073b81CA8C94c9bf3d7bE40`](https://testnet.bscscan.com/address/0x3EC73D238BDCBc408073b81CA8C94c9bf3d7bE40) |  |
| DEFI13 — PancakeSwap pool | [`0x623720a6bdC9679174cd66320fBB36bB6666d7dB`](https://testnet.bscscan.com/address/0x623720a6bdC9679174cd66320fBB36bB6666d7dB) |  |
| Dollar & Yield (YIELD13) — vault | [`0x3d855484103c88976A3c4DB87Cdc5e07E3Cf1977`](https://testnet.bscscan.com/address/0x3d855484103c88976A3c4DB87Cdc5e07E3Cf1977) | launch |
| YIELD13 — portfolio token | [`0xE14379E297fb35849f1479083ea9F4f38b6c9303`](https://testnet.bscscan.com/address/0xE14379E297fb35849f1479083ea9F4f38b6c9303) |  |
| YIELD13 — PancakeSwap pool | [`0x961DaF5ac8CB3A12Ea7a921Db7102f269A62677c`](https://testnet.bscscan.com/address/0x961DaF5ac8CB3A12Ea7a921Db7102f269A62677c) |  |
| Tokenized Technology (TECH13) — vault | [`0x96Ac3e52deA9840B1AbAAabbdA8750b27415b7e3`](https://testnet.bscscan.com/address/0x96Ac3e52deA9840B1AbAAabbdA8750b27415b7e3) | launch · [tx](https://testnet.bscscan.com/tx/0xa62fd9cddbc53b8edc87f82132a7b0ec12279ccce5608c3c2a3ea33d6d8d7ebd) |
| TECH13 — portfolio token | [`0x08F6fC3e00FC106f7411EA9b964186B70fD07257`](https://testnet.bscscan.com/address/0x08F6fC3e00FC106f7411EA9b964186B70fD07257) |  |
| TECH13 — PancakeSwap pool | [`0x514326a572efeE783844710476EE13643127Fd0D`](https://testnet.bscscan.com/address/0x514326a572efeE783844710476EE13643127Fd0D) |  |
| Markets & Emerging (MKT13) — vault | [`0x9AB512933bAa47e1c5b26A6Db0dddA4436E910cc`](https://testnet.bscscan.com/address/0x9AB512933bAa47e1c5b26A6Db0dddA4436E910cc) | launch · [tx](https://testnet.bscscan.com/tx/0x6ea70fa34bcfa96f572c3e9f21dd00e03a1184e2d1fc24e2bb6205c996534c79) |
| MKT13 — portfolio token | [`0x7699dC891Dd6eB8dc183b68a222CA1C84Dd9a2F5`](https://testnet.bscscan.com/address/0x7699dC891Dd6eB8dc183b68a222CA1C84Dd9a2F5) |  |
| MKT13 — PancakeSwap pool | [`0x6dCEcCcf460Ed017a4a3e8A0CA92C95BF11E426A`](https://testnet.bscscan.com/address/0x6dCEcCcf460Ed017a4a3e8A0CA92C95BF11E426A) |  |
| TEST (TEST) — vault | [`0xA67cd4f50EFE61215B1FF078F59471e21b1C242e`](https://testnet.bscscan.com/address/0xA67cd4f50EFE61215B1FF078F59471e21b1C242e) | launched from the IndexFi UI |

## 2. Flap launch venue (direct launch, Flap Portal)

### 2.1 IndexFi Flap contracts

| Contract | Address | Notes |
|---|---|---|
| IndexFiFlapFactory (Launcher Factory) | [`0x87c785f79B371D2a16EFB598655d9574e41d8233`](https://testnet.bscscan.com/address/0x87c785f79B371D2a16EFB598655d9574e41d8233) | enabled on the Portal: (true, 0) · [tx](https://testnet.bscscan.com/tx/0xf5b80b2e2aa1a06e50eb795e8912eb3f96ac1c959be54859281b71149e5a2fe7) |
| IndexFiFlapVaultFactory | [`0x6beE121Dc8894Aa7440344F6C00Ba0CeACE5c4e2`](https://testnet.bscscan.com/address/0x6beE121Dc8894Aa7440344F6C00Ba0CeACE5c4e2) | native vault factory (created by the factory) |
| IndexFiFlapVault (implementation) | [`0xF5b320693d57a73d5Ded92E2d2Dfe4efF7E960E6`](https://testnet.bscscan.com/address/0xF5b320693d57a73d5Ded92E2d2Dfe4efF7E960E6) | immutable logic · [tx](https://testnet.bscscan.com/tx/0x8f5d08fc52b0effa94a0771f9180ef7166ed2de98a314e42155c7fe16325a1b9) |
| AtlasSignedOracle (Flap USD) | [`0xFDD2c08591A04f44cA9dF2537b2926B12A9CE304`](https://testnet.bscscan.com/address/0xFDD2c08591A04f44cA9dF2537b2926B12A9CE304) | Atlas-signed prices, bound to Flap USD · [tx](https://testnet.bscscan.com/tx/0xca4b9d30d2dffc26dcec86881e5862b2ef3ccff23e04da3f47145bb68e9ed96c) |
| PancakeV2BasketAdapter (Flap USD) | [`0x027EAC808Ff84Bf781bDDe09289F89F724f246F8`](https://testnet.bscscan.com/address/0x027EAC808Ff84Bf781bDDe09289F89F724f246F8) | 66 asset routes · [tx](https://testnet.bscscan.com/tx/0xcc7de0dd51cfd8f76e193eba37df1908bbd82b318bfd045498d46513b9c9b69f) |

Factory enabled through the Flap whitelist helper: [tx](https://testnet.bscscan.com/tx/0xc1d1a062d025536a4e89b2e49d1cf957471037a1d90cf9eb1755b0fd6b6e5b2f).

### 2.2 Flap protocol contracts used (official, not deployed by IndexFi)

| Contract | Address | Notes |
|---|---|---|
| Flap Portal | [`0x000042108465206185A077Edc3F3fd2b49060000`](https://testnet.bscscan.com/address/0x000042108465206185A077Edc3F3fd2b49060000) |  |
| Flap Token Dock | [`0x000048E888aBf09f690a952E1b386b2D031a0000`](https://testnet.bscscan.com/address/0x000048E888aBf09f690a952E1b386b2D031a0000) |  |
| Flap whitelist helper | [`0x77779969a11eff7582f3bCf48135A846A3457777`](https://testnet.bscscan.com/address/0x77779969a11eff7582f3bCf48135A846A3457777) |  |
| Flap USD (settlement) | [`0x190C989D5665a0e404B444b53CAE9AbCfb600157`](https://testnet.bscscan.com/address/0x190C989D5665a0e404B444b53CAE9AbCfb600157) |  |
| Flap tax-token implementation | [`0x7777c57ff7dc441c1715b2e36fa581c48b782222`](https://testnet.bscscan.com/address/0x7777c57ff7dc441c1715b2e36fa581c48b782222) |  |

### 2.3 Flap demo portfolio (full lifecycle on chain 97)

| Contract | Address | Notes |
|---|---|---|
| Demo portfolio vault | [`0xA3BB40390028Da5ceC9D809AAf658eE70948fC5A`](https://testnet.bscscan.com/address/0xA3BB40390028Da5ceC9D809AAf658eE70948fC5A) | launch · [tx](https://testnet.bscscan.com/tx/0x379333f12d901631ca145b68bb150e554f358c80b87a4f9f31425172109674ad) |
| Demo portfolio token (…7777, Flap tax token) | [`0x72F9B07906794d1be9f7d431Ab7Ef5a105d27777`](https://testnet.bscscan.com/address/0x72F9B07906794d1be9f7d431Ab7Ef5a105d27777) | address predicted from the mined salt |
| Demo PancakeSwap pool | [`0x1c42FEF67DC9AeF66f5E5BEE728EF516C97096b9`](https://testnet.bscscan.com/address/0x1c42FEF67DC9AeF66f5E5BEE728EF516C97096b9) | initial LP burned |

Lifecycle transactions: deposit [tx](https://testnet.bscscan.com/tx/0x81b25974ab2a60522595d9bfe4351947c0db5d57fab741627a9484f10959f232) · buy [tx](https://testnet.bscscan.com/tx/0x8b47dc2ee9f606a23879774e586d5bf5df4e9c367d9b870bc70c8fb7aac28c39) · sell [tx](https://testnet.bscscan.com/tx/0x6175f91a9e920fec9b9032ddef4d39bbbe2b2addd31e1184ef8b21f99bd16278) · redeemCash [tx](https://testnet.bscscan.com/tx/0xe2e7eca28cc5d837c13322b1aa39f06cfc1a67ce87b7c7bfa0e5953280cd894e) · redeemInKind [tx](https://testnet.bscscan.com/tx/0x0b880cd3831fe983234c4c66176d89c8fc5634849eb067bfa50ebd94db082b9f) · forwardTaxRevenue [tx](https://testnet.bscscan.com/tx/0xf14570a2365e9676b6cb62466761aa86f204d703f941f14bbb3649432c1735ee)

## 3. Test assets (66 tokens standing in for the Atlas-priced mainnet assets)

Owner-mint test tokens on chain 97. Each has a PancakeSwap pool against test USDT (OpenFour) and against Flap USD (Flap).

| Asset | Token | OpenFour pool | Flap pool |
|---|---|---|---|
| AAVE | [`0xdbc3657F4A58f81139B01Da5a99FDc7025D9C39B`](https://testnet.bscscan.com/address/0xdbc3657F4A58f81139B01Da5a99FDc7025D9C39B) | [pool](https://testnet.bscscan.com/address/0x57869f0FD2fc2535027Ff7739b990943b48c96F7) | [pool](https://testnet.bscscan.com/address/0xf34284bd0406d506eD8c6f986cf0AAd499B744Ee) |
| AB | [`0xD378aaf3011df1159b7e76EABa7B018731B3fed7`](https://testnet.bscscan.com/address/0xD378aaf3011df1159b7e76EABa7B018731B3fed7) | [pool](https://testnet.bscscan.com/address/0x8dc87e7D5b86196008c812544a279fF505B9cdfb) | [pool](https://testnet.bscscan.com/address/0x67c01D985cC4622F7E6A1A9C23fC5FA1A5c0478d) |
| ADA | [`0xb1581B7c082996dC48265Ca9D0ce979B6d629B6d`](https://testnet.bscscan.com/address/0xb1581B7c082996dC48265Ca9D0ce979B6d629B6d) | [pool](https://testnet.bscscan.com/address/0x5AFA6A75331f810F678dB2FE5e38a9bDD7e87714) | [pool](https://testnet.bscscan.com/address/0xD188d9Da52E471F83A1F84c722598437d380B59f) |
| AMDB | [`0x5B885E2F29F11785c732C244f8010d035ED91aE7`](https://testnet.bscscan.com/address/0x5B885E2F29F11785c732C244f8010d035ED91aE7) | [pool](https://testnet.bscscan.com/address/0xB6469F9D272eAC70655258F4da47E7C0B9286e5A) | [pool](https://testnet.bscscan.com/address/0x142184B11D4001002549F67CcAe80D27fc76294c) |
| ANKR | [`0x70261cAAC191BcD87Db1A083F9DDC2f01Bebfcd1`](https://testnet.bscscan.com/address/0x70261cAAC191BcD87Db1A083F9DDC2f01Bebfcd1) | [pool](https://testnet.bscscan.com/address/0x09A9daf880B6900Df26BF2f9A067cf74d3e1B97E) | [pool](https://testnet.bscscan.com/address/0x825d7F48427b839ED18B9F4c5A8718dD4024E972) |
| ANTB | [`0x95bba56169092585Ab39eEB6d99CA65d861fF68F`](https://testnet.bscscan.com/address/0x95bba56169092585Ab39eEB6d99CA65d861fF68F) | [pool](https://testnet.bscscan.com/address/0x7cb58A4065756F9096e812aEb1eDd23EBDC0C5e7) | [pool](https://testnet.bscscan.com/address/0x164f773284C124418A60F8a2Fc9Cfc508b5cBE3a) |
| ASTER | [`0xe448d27273ED0AAa73447D0a5f5A797126EABbd7`](https://testnet.bscscan.com/address/0xe448d27273ED0AAa73447D0a5f5A797126EABbd7) | [pool](https://testnet.bscscan.com/address/0xdC0A28b272F8EbA27b6687c5FbA81926A1aDe246) | [pool](https://testnet.bscscan.com/address/0xF7d8dfBb5b9B19bddd625b7058ED13417808373b) |
| AT | [`0xbb8bf2B9Bd82eB1e1a05eAaF3dd0ff6A1F8200DF`](https://testnet.bscscan.com/address/0xbb8bf2B9Bd82eB1e1a05eAaF3dd0ff6A1F8200DF) | [pool](https://testnet.bscscan.com/address/0x101bB64210334CDcB2243188392D3eF7bc907C78) | [pool](https://testnet.bscscan.com/address/0x850c50bCc9f89c3A01659b246cc0fAB48878090B) |
| AVAX | [`0x57789C3e30d827516bE43E8da565fDBE92dD8C66`](https://testnet.bscscan.com/address/0x57789C3e30d827516bE43E8da565fDBE92dD8C66) | [pool](https://testnet.bscscan.com/address/0xcE717b3C93735956Ef9A81d23a6188174A1427F2) | [pool](https://testnet.bscscan.com/address/0x18a0Be9DcC6F2e2e135aC4405E526fBf05E2C557) |
| B | [`0xFb8533c12341a858603C4d728139AcB49BF5cbb5`](https://testnet.bscscan.com/address/0xFb8533c12341a858603C4d728139AcB49BF5cbb5) | [pool](https://testnet.bscscan.com/address/0xB51B7400dcAB883d0e8D0B9B7949afF0f6Ee927F) | [pool](https://testnet.bscscan.com/address/0x7239E3646A87e98bC356C15B11e5D422088870C6) |
| B2 | [`0xc1828fC525A7f9E9D61bfaa38137FcB7224c505E`](https://testnet.bscscan.com/address/0xc1828fC525A7f9E9D61bfaa38137FcB7224c505E) | [pool](https://testnet.bscscan.com/address/0xF56DB6fA48C7324EE00f9d01539343d1c762C6e7) | [pool](https://testnet.bscscan.com/address/0xF1851176a75DE9d88E0f0aEd5d9AE7cDe99E043C) |
| BCH | [`0x283392ECd2c49B120fFb2b047d66F14EbC04660D`](https://testnet.bscscan.com/address/0x283392ECd2c49B120fFb2b047d66F14EbC04660D) | [pool](https://testnet.bscscan.com/address/0xE63dfd01F3FCCa94D0124aB19D7919F5809f8815) | [pool](https://testnet.bscscan.com/address/0xffc988C7c3769c6286bcC0ef16818Fb01E08435A) |
| BTCB | [`0x658d0beE6976f93baA764eD479600b090775d963`](https://testnet.bscscan.com/address/0x658d0beE6976f93baA764eD479600b090775d963) | [pool](https://testnet.bscscan.com/address/0x232AcA39F70FD4E2596dd446f75cC5A22eB1E317) | [pool](https://testnet.bscscan.com/address/0x55e3632b6e29dB0AC1e72a0dDb9b53D777fb99F2) |
| BUSD | [`0x5ab1A2eeD8E574B2F0F3baDa6d0747c2E713F4aE`](https://testnet.bscscan.com/address/0x5ab1A2eeD8E574B2F0F3baDa6d0747c2E713F4aE) | [pool](https://testnet.bscscan.com/address/0xd1c8Fe22D9Da1cAA396C5496222c12377E39B926) | [pool](https://testnet.bscscan.com/address/0x47A94301d2F9A76Ba36d60eb3EDbd2ee38d4Fb7B) |
| CAKE | [`0x2b5b2d0b0250dD0CDAF70121159a36C6DE309b9f`](https://testnet.bscscan.com/address/0x2b5b2d0b0250dD0CDAF70121159a36C6DE309b9f) | [pool](https://testnet.bscscan.com/address/0xB2Db2fB77734a5ED4FE8420823c11ba0bceaE423) | [pool](https://testnet.bscscan.com/address/0xf79a48F243D2E990caEC0bE082916b67A2f67282) |
| CBRSB | [`0x8d650e94Bc91B47eC381cB6E4f70a4eb2d77B633`](https://testnet.bscscan.com/address/0x8d650e94Bc91B47eC381cB6E4f70a4eb2d77B633) | [pool](https://testnet.bscscan.com/address/0x1C54600458E9AC01eDc61DEC56BA5201995b0eC8) | [pool](https://testnet.bscscan.com/address/0xC1E24eF5a8742A6eeD9197Be4314463439C5Df5E) |
| CC | [`0xCC704c9143e8b64F8460eb2258621b237E0db270`](https://testnet.bscscan.com/address/0xCC704c9143e8b64F8460eb2258621b237E0db270) | [pool](https://testnet.bscscan.com/address/0x77408CC8eF541D30F045B8A68A0404422bd513dd) | [pool](https://testnet.bscscan.com/address/0x212EF20E20bD76Dcc89a3f349F7AE57C20bAC262) |
| CDL | [`0x4025Eb4A0eD208970c9770662F9C3a10b40163e1`](https://testnet.bscscan.com/address/0x4025Eb4A0eD208970c9770662F9C3a10b40163e1) | [pool](https://testnet.bscscan.com/address/0xc6E79Cec123Cfe057Bbf13BD5050596b5DaeD5AF) | [pool](https://testnet.bscscan.com/address/0x102eB22161fe61684EA738a3C3FEbA3468316021) |
| COINB | [`0xa7042c4B0B8505EEAa229249b7a302e10be0A7Ff`](https://testnet.bscscan.com/address/0xa7042c4B0B8505EEAa229249b7a302e10be0A7Ff) | [pool](https://testnet.bscscan.com/address/0x373b39AD3dd15bF600857f0A677179BC273b97aB) | [pool](https://testnet.bscscan.com/address/0x95444aD78d7A4E814996694d6D72bF8f1DB223d2) |
| DAI | [`0xCbc75223d76DAB1CbAa8EdaC4b21734d1099c6BD`](https://testnet.bscscan.com/address/0xCbc75223d76DAB1CbAa8EdaC4b21734d1099c6BD) | [pool](https://testnet.bscscan.com/address/0x66a7C3AE339353cD80Eae338c442591de7f42085) | [pool](https://testnet.bscscan.com/address/0x7f1dA71DcAfcC9FC1C83caCA579D176983AaD887) |
| DOGE | [`0x0E2d88151305b73D367879C675A456A909517154`](https://testnet.bscscan.com/address/0x0E2d88151305b73D367879C675A456A909517154) | [pool](https://testnet.bscscan.com/address/0xf5EDbe2Fb3e207272B65a84b6AC776a49AD3411f) | [pool](https://testnet.bscscan.com/address/0x98e38A90aB2F4E32c6e97EAeaa2FAe6f5736f9C9) |
| DOT | [`0x70d4f469D03Eb01FaAF525651c285804B113Aa6f`](https://testnet.bscscan.com/address/0x70d4f469D03Eb01FaAF525651c285804B113Aa6f) | [pool](https://testnet.bscscan.com/address/0xf78D48f6A32Ee0E7A660B9656C6c9D686c23efcf) | [pool](https://testnet.bscscan.com/address/0xe1aD7a4526CEdfaB9bEec49755B8451C9d0E2018) |
| DRAMB | [`0x38249d40aFB5cD5b5f5CBAE874988e4bCDDb49aC`](https://testnet.bscscan.com/address/0x38249d40aFB5cD5b5f5CBAE874988e4bCDDb49aC) | [pool](https://testnet.bscscan.com/address/0x5f8B7AFB3299dE6564Ffaa9e65d0a12eAf33F195) | [pool](https://testnet.bscscan.com/address/0x3c041a7AC2361A7d7bD854e20Ab038cdD0559FD1) |
| EGL1 | [`0x7DBfa76784d43eB4dF2D78AE509272b28Fc8F4FE`](https://testnet.bscscan.com/address/0x7DBfa76784d43eB4dF2D78AE509272b28Fc8F4FE) | [pool](https://testnet.bscscan.com/address/0xBa3cb6DAFa7Daf2e646ACC8Fce861B7F55791aB9) | [pool](https://testnet.bscscan.com/address/0xAc5672fd12fE46fc1b303f9D9D1E7c1d54B4F3e7) |
| ETH | [`0x71FAca52447053A9441908EF2f4f72A03cf90dEB`](https://testnet.bscscan.com/address/0x71FAca52447053A9441908EF2f4f72A03cf90dEB) | [pool](https://testnet.bscscan.com/address/0xCE9fC051C3AeB5d9444A10966Bec5Da3FCAc525e) | [pool](https://testnet.bscscan.com/address/0x0C22F485dbD02bB8c2FCde962AEF4C2C364f1f18) |
| EWYB | [`0xde59Bb0164BCcf2a79B62CDB51740680567bE778`](https://testnet.bscscan.com/address/0xde59Bb0164BCcf2a79B62CDB51740680567bE778) | [pool](https://testnet.bscscan.com/address/0x3bA44613166B58DA27c96E35A4DCA2222E5805E9) | [pool](https://testnet.bscscan.com/address/0xe6f3E4e8b6244d8D83febC60931cf74c391E2a3e) |
| FDUSD | [`0x510B30b5c46e00403f75Eb935080aBcfe0953d06`](https://testnet.bscscan.com/address/0x510B30b5c46e00403f75Eb935080aBcfe0953d06) | [pool](https://testnet.bscscan.com/address/0xA96ABb102B49d65F87B56d3598C08382f41c6434) | [pool](https://testnet.bscscan.com/address/0x44d9eb3F05488DF9f90C28dE1952461aE2775f16) |
| FIL | [`0x0E78c4aBD951aC9b2260B1eED09DdD94E5355556`](https://testnet.bscscan.com/address/0x0E78c4aBD951aC9b2260B1eED09DdD94E5355556) | [pool](https://testnet.bscscan.com/address/0xA8024aD30ae6d31f140e09Ab550648CaeF692F43) | [pool](https://testnet.bscscan.com/address/0x717FB1a817958BC4efda990343f24aABEA1AedFd) |
| GLWB | [`0x973A1017B1e00D1E30bF834f96DeD975A112Ff9C`](https://testnet.bscscan.com/address/0x973A1017B1e00D1E30bF834f96DeD975A112Ff9C) | [pool](https://testnet.bscscan.com/address/0xcBFC3a9BEB43daD1FD1De085F167E6A22063d2f2) | [pool](https://testnet.bscscan.com/address/0x63F011E160fc4b788A0E5454e400c152F6B63A7a) |
| GOOGLB | [`0x1D5C21F66bbcE6B0798764075500BFb3DBc5f1e2`](https://testnet.bscscan.com/address/0x1D5C21F66bbcE6B0798764075500BFb3DBc5f1e2) | [pool](https://testnet.bscscan.com/address/0xF8b5a8207834da2Fa781E95DDaAbDb33F6E6a310) | [pool](https://testnet.bscscan.com/address/0xE20535FDAFBcD3772b9FD9d36Ec30C5bF71949Ac) |
| INTCB | [`0xecf27c019717AC98C38D3d769C69F798A99B33FC`](https://testnet.bscscan.com/address/0xecf27c019717AC98C38D3d769C69F798A99B33FC) | [pool](https://testnet.bscscan.com/address/0xC1658757D382D998b6eb7447784f024C15f6df8D) | [pool](https://testnet.bscscan.com/address/0x70A69424190fC47CeAB9774aBB38c5372c703939) |
| LINK | [`0x4F9CE86525d07FD2CA4403F10774f77f26a5b120`](https://testnet.bscscan.com/address/0x4F9CE86525d07FD2CA4403F10774f77f26a5b120) | [pool](https://testnet.bscscan.com/address/0xc4b2Cdd34910d8e4bCf46ac4F49773C2EC1B0b43) | [pool](https://testnet.bscscan.com/address/0xfE333eC68C5fd6545f991E1B7E8F0A0aC8756Dd2) |
| LITEB | [`0x93a5aC6bb36d5bBd1149b4945e616113A0E40b25`](https://testnet.bscscan.com/address/0x93a5aC6bb36d5bBd1149b4945e616113A0E40b25) | [pool](https://testnet.bscscan.com/address/0x5434efed522C4AED857aE25BAe36A8427FC21172) | [pool](https://testnet.bscscan.com/address/0x534c63519779e051C14e04712702ec772f5c6f65) |
| LTC | [`0xbA7d084CA7aA548200C9A64132e5c5709a3993b3`](https://testnet.bscscan.com/address/0xbA7d084CA7aA548200C9A64132e5c5709a3993b3) | [pool](https://testnet.bscscan.com/address/0xEBc994d8a7AF01fBC1AbbDAa1172d099B93C125A) | [pool](https://testnet.bscscan.com/address/0x99E03c0DCFD09811d7e70D01C5523631dC637d90) |
| M | [`0x109faFFfD7976c0719eFD222c8693DC7921b0D30`](https://testnet.bscscan.com/address/0x109faFFfD7976c0719eFD222c8693DC7921b0D30) | [pool](https://testnet.bscscan.com/address/0xEc7FE15F05D9e0d8a923a6Bb8F4e507957309a4F) | [pool](https://testnet.bscscan.com/address/0x971965708e8d24A09aC8c213a1F8F78A3CC25428) |
| METAB | [`0x9550d0A327410DcA4Cda4240B81ee19AE125C754`](https://testnet.bscscan.com/address/0x9550d0A327410DcA4Cda4240B81ee19AE125C754) | [pool](https://testnet.bscscan.com/address/0x9069D87f223f5ea7892DAc6906b98280f5662eED) | [pool](https://testnet.bscscan.com/address/0x9C30b2C7DF0A7Da4900CceF001e26Ca1BBa63f88) |
| MSFTB | [`0x428e1CC700770dCd4A5eCF910326037F1e22E8e2`](https://testnet.bscscan.com/address/0x428e1CC700770dCd4A5eCF910326037F1e22E8e2) | [pool](https://testnet.bscscan.com/address/0xaBe2ADD4DD74C48d430299463CFcBC031B2F2e6C) | [pool](https://testnet.bscscan.com/address/0x590C34913A47b1cc5B0E7a057d9054a8dA469064) |
| MSTRB | [`0x6D3799812ED28a5c20CA76880182A4Dae9147bAE`](https://testnet.bscscan.com/address/0x6D3799812ED28a5c20CA76880182A4Dae9147bAE) | [pool](https://testnet.bscscan.com/address/0xdab3e70bE3761e21f0c4001cc919599b2412DFE6) | [pool](https://testnet.bscscan.com/address/0xe0F0a3E8c19cDEBf0c82799857c84B13eE5853Ed) |
| NBISB | [`0x129CB96d195Bd473883315654b76EA2DEDE7249F`](https://testnet.bscscan.com/address/0x129CB96d195Bd473883315654b76EA2DEDE7249F) | [pool](https://testnet.bscscan.com/address/0xB9425d3F1812E6636dfDd5605234f5e224232d73) | [pool](https://testnet.bscscan.com/address/0x4795ebfe30570fAA72bCe3BEdF491d78DfE0F78b) |
| NEAR | [`0xf36469776131d5f3fe6C15Cb3EaDb35663E44470`](https://testnet.bscscan.com/address/0xf36469776131d5f3fe6C15Cb3EaDb35663E44470) | [pool](https://testnet.bscscan.com/address/0x90bc7EbA19Ad7D811833820251047a3F863f3656) | [pool](https://testnet.bscscan.com/address/0x95337fbcCf6DC58904Bc5aa389CD7cf666D5177C) |
| OIK | [`0xd1eEEee7101947f2Afb3930237F571F54330cB92`](https://testnet.bscscan.com/address/0xd1eEEee7101947f2Afb3930237F571F54330cB92) | [pool](https://testnet.bscscan.com/address/0xF80C4131bf0eC44f7D330E9027aE7F8aBb2eF38F) | [pool](https://testnet.bscscan.com/address/0xe01Af0BD84b93Ec12bA5Cae3c0A3017f8D37C823) |
| PLTRB | [`0x7ad0581ffdAdafAed01e76647f796849b6913004`](https://testnet.bscscan.com/address/0x7ad0581ffdAdafAed01e76647f796849b6913004) | [pool](https://testnet.bscscan.com/address/0xf54899E7A2Edd2581c10CE6a0694420CB29FB902) | [pool](https://testnet.bscscan.com/address/0x6a113C1eDCa1Fc82B90c750cEEDd8431f8F58766) |
| PUFFER | [`0xccB19Bf327C94A17eFE604d7BddA69fcC4Dd30f3`](https://testnet.bscscan.com/address/0xccB19Bf327C94A17eFE604d7BddA69fcC4Dd30f3) | [pool](https://testnet.bscscan.com/address/0xABbBC888a2A22f261B4CFD167AAef3a923379b40) | [pool](https://testnet.bscscan.com/address/0x7d4Ec9fa49437F1F8d5935f95E89a3faaaFfBBE5) |
| QCOMB | [`0xd651645C4441F400267d4060d6c1Ec3B5fC393bb`](https://testnet.bscscan.com/address/0xd651645C4441F400267d4060d6c1Ec3B5fC393bb) | [pool](https://testnet.bscscan.com/address/0x86A71fB7B3ac3Bd26e2744f5612937Eb06586933) | [pool](https://testnet.bscscan.com/address/0xB107F3531BB18c46a44EC1475B37C9eD813023D2) |
| QQQB | [`0x787b969281a4c1Ec67b137a6c503bac4dF375baD`](https://testnet.bscscan.com/address/0x787b969281a4c1Ec67b137a6c503bac4dF375baD) | [pool](https://testnet.bscscan.com/address/0x4173270373219FaCDeC3f5e245895b470dA0FBf1) | [pool](https://testnet.bscscan.com/address/0xa3b4F82661cf4792a72b123ABbF39729D9DB6651) |
| SHIB | [`0xd8DBF8A7e9B35111fb29F074FdB96A2E7265AEB8`](https://testnet.bscscan.com/address/0xd8DBF8A7e9B35111fb29F074FdB96A2E7265AEB8) | [pool](https://testnet.bscscan.com/address/0x93c899084E4e83eB7dE2A2FE605c257Cdc3C17B3) | [pool](https://testnet.bscscan.com/address/0x72E0635706dF36a253E47313Ad7955A33839473F) |
| slisBNB | [`0x03f4F1Adb088848648fe3eABEc4c3846FFE8b2CC`](https://testnet.bscscan.com/address/0x03f4F1Adb088848648fe3eABEc4c3846FFE8b2CC) | [pool](https://testnet.bscscan.com/address/0x31228d5A49a8eF80bF08545f130B0b7132c7E671) | [pool](https://testnet.bscscan.com/address/0xC5e7c55BdD3a42c9c0fDaCAA776D03f8c7185cBC) |
| SOL | [`0x9f5e7bCbf9bEB13D9a470b20c689918678eED682`](https://testnet.bscscan.com/address/0x9f5e7bCbf9bEB13D9a470b20c689918678eED682) | [pool](https://testnet.bscscan.com/address/0xe98d082Eb4BFA5d742AA6D5DBd0537C7Af2f4aC4) | [pool](https://testnet.bscscan.com/address/0x847A38E7685FA67a80489a913009EE837ebbE0FE) |
| SOXLB | [`0xa49d2E6B8E11d7f3f6051e060982fc382C30cDB0`](https://testnet.bscscan.com/address/0xa49d2E6B8E11d7f3f6051e060982fc382C30cDB0) | [pool](https://testnet.bscscan.com/address/0xCE2C611fECb95EEE1F305bab7c54561068e88BE0) | [pool](https://testnet.bscscan.com/address/0x44636EC9bc70e68086C4f3C4bCc8896CC27dE7b2) |
| SPA | [`0xbe1e73360084053671308C745B5Ab7945EC4bd1b`](https://testnet.bscscan.com/address/0xbe1e73360084053671308C745B5Ab7945EC4bd1b) | [pool](https://testnet.bscscan.com/address/0xE8D9cc7f0ED06e7F0B0af20e6Bb1dD2bC6BcE3e0) | [pool](https://testnet.bscscan.com/address/0x6554c1A54Efd38D8be57Ee1F9Bb408B2A71CB9De) |
| SPYB | [`0x27fDFd8BC9129eb76b2b2b046373E00361bAAe09`](https://testnet.bscscan.com/address/0x27fDFd8BC9129eb76b2b2b046373E00361bAAe09) | [pool](https://testnet.bscscan.com/address/0xe4E293dB5c14c82E62C7794EbAc5469d0485fB77) | [pool](https://testnet.bscscan.com/address/0x2333DE78965464664Fe09e4b587141B2421d6eC1) |
| SQQQB | [`0xdBA4dd3C5007f1118B1Fc65271a2F7e933C14b4F`](https://testnet.bscscan.com/address/0xdBA4dd3C5007f1118B1Fc65271a2F7e933C14b4F) | [pool](https://testnet.bscscan.com/address/0x43dE0b01964c83bC9CEc87754fBc02cDa688f501) | [pool](https://testnet.bscscan.com/address/0x81E74C56A4c2d805971E9134675fc7008A6ebB09) |
| TAKE | [`0x3Bd8B33f4B4183bE66210740E2d6a4C1fA9dB802`](https://testnet.bscscan.com/address/0x3Bd8B33f4B4183bE66210740E2d6a4C1fA9dB802) | [pool](https://testnet.bscscan.com/address/0x788d3fA07631eF67Db298e5915741561dDa1Ea68) | [pool](https://testnet.bscscan.com/address/0x41d2CeBceCCF2175A9108157872540e3c706c2Cf) |
| TUSD | [`0xf6c724c1B5A9e9d32717a6A558B53dCfA393b1Ab`](https://testnet.bscscan.com/address/0xf6c724c1B5A9e9d32717a6A558B53dCfA393b1Ab) | [pool](https://testnet.bscscan.com/address/0x57cbB7Ce9965994034DF80afC680EF630423f565) | [pool](https://testnet.bscscan.com/address/0x7492FC622B2268c53bE6D319373551968e9Da3A1) |
| TWT | [`0x89ffE77af9C81c24C655335638F3ef61306704B8`](https://testnet.bscscan.com/address/0x89ffE77af9C81c24C655335638F3ef61306704B8) | [pool](https://testnet.bscscan.com/address/0x8923c78Fa04aa7077929E0E791e753358c926f43) | [pool](https://testnet.bscscan.com/address/0x2579B029695F1d06802b306e208E3d91c5730d43) |
| UNI | [`0x9F35D15787e7edf562CFA7e7783dc9eC98E9386E`](https://testnet.bscscan.com/address/0x9F35D15787e7edf562CFA7e7783dc9eC98E9386E) | [pool](https://testnet.bscscan.com/address/0xeF84dC5E7273A1644B6793aA2F4de3Cf1c324fb2) | [pool](https://testnet.bscscan.com/address/0x87B0A09d46abb8cbD5b971f4eF93Ed107137e59B) |
| USD1 | [`0x5A82630c0c485eCa159099bA34E98dC99C6964C8`](https://testnet.bscscan.com/address/0x5A82630c0c485eCa159099bA34E98dC99C6964C8) | [pool](https://testnet.bscscan.com/address/0xD04fd488B91634Af8341F4D6b18379cfBAa8d4a1) | [pool](https://testnet.bscscan.com/address/0x1c4DdCa4F7DC4AD6f7B99F185479b00f97364481) |
| USDe | [`0xf1d6182CaE2DEDdB45d3AC5e5E89512d2c4d347e`](https://testnet.bscscan.com/address/0xf1d6182CaE2DEDdB45d3AC5e5E89512d2c4d347e) | [pool](https://testnet.bscscan.com/address/0xCe013C8424118E168C69c43C74D74eaA4394DF7e) | [pool](https://testnet.bscscan.com/address/0x7Dc65A1Ca864f0d6c409c1f4c7b158768C68851E) |
| USDT | [`0xf587997669189E6F20b78E1A557e3fAD8E8A61D3`](https://testnet.bscscan.com/address/0xf587997669189E6F20b78E1A557e3fAD8E8A61D3) | [pool](https://testnet.bscscan.com/address/0xAe8c27745E189BcAd2b983dcA42Da4acED964A85) | [pool](https://testnet.bscscan.com/address/0xc1eF0F3ccba06e680479d2464B9dCc0983dc42e9) |
| VAI | [`0x4E9E7E716b9d7C099FA83691B295A3CF53ddd261`](https://testnet.bscscan.com/address/0x4E9E7E716b9d7C099FA83691B295A3CF53ddd261) | [pool](https://testnet.bscscan.com/address/0x72594887Fd60D5e38F70D53AD025b21B4c2F40be) | [pool](https://testnet.bscscan.com/address/0x84c9BDFa2646969Bada03B247932107fc6104c02) |
| wBETH | [`0xE886265B03FA271E6fF75a96D6885Cd8682e5241`](https://testnet.bscscan.com/address/0xE886265B03FA271E6fF75a96D6885Cd8682e5241) | [pool](https://testnet.bscscan.com/address/0xbd871a22657AeACBd70f0437dbA1868466F92925) | [pool](https://testnet.bscscan.com/address/0x80C9A6FFf88F1aA542D76deF53bfB1C1E446DD2d) |
| WDCB | [`0x5413a16Fb103Df9390245A472Abd0DdcBBF684D7`](https://testnet.bscscan.com/address/0x5413a16Fb103Df9390245A472Abd0DdcBBF684D7) | [pool](https://testnet.bscscan.com/address/0x52E82A13afEbD1d21a73DC44f7308453f0c99Ce8) | [pool](https://testnet.bscscan.com/address/0x291F2b0e38a755587F036E3192F6237aE8506ce0) |
| XRP | [`0x0C4b6Fb9f22fBDdcFf6d7Fa7C0006f5A36d0BD1d`](https://testnet.bscscan.com/address/0x0C4b6Fb9f22fBDdcFf6d7Fa7C0006f5A36d0BD1d) | [pool](https://testnet.bscscan.com/address/0xBa867C2feEf9923964F787bF4A2D35Ef689BCA32) | [pool](https://testnet.bscscan.com/address/0x51bE70fAff90228adE36af95F3dC1EC1EC7507A0) |
| XUSD | [`0x0CE96B105C914Ea79C3DC31d1644046D1df460B6`](https://testnet.bscscan.com/address/0x0CE96B105C914Ea79C3DC31d1644046D1df460B6) | [pool](https://testnet.bscscan.com/address/0x913C0016cAD6472C933DCeb2c929639B2D0289ec) | [pool](https://testnet.bscscan.com/address/0xF23537172c42cA03734b2B49455FE9916EcfCe85) |
| XVS | [`0xFe69b14A64eECB31Cc5b032a4BC599AC1d145F79`](https://testnet.bscscan.com/address/0xFe69b14A64eECB31Cc5b032a4BC599AC1d145F79) | [pool](https://testnet.bscscan.com/address/0x768b74D1B1693643D82d10631c435A7cFB104d01) | [pool](https://testnet.bscscan.com/address/0x54D8C586F73F7564e08Cf736263B58d4dCb0b762) |
| ZEC | [`0x95d40912787762629d8bA6aec041eF2FB354B4fb`](https://testnet.bscscan.com/address/0x95d40912787762629d8bA6aec041eF2FB354B4fb) | [pool](https://testnet.bscscan.com/address/0x529F4eeDFe7E950a995EB83a137A3a48C2618F85) | [pool](https://testnet.bscscan.com/address/0xD39dA9B5166eEC2EacE53928157240f955a93bCc) |

## 4. Accounts

| Role | Address |
|---|---|
| Operator / deployer / OpenFour signer | [`0xB64c94312De7Ff21FBb7f323Bfc3d9f1A6A3f1cE`](https://testnet.bscscan.com/address/0xB64c94312De7Ff21FBb7f323Bfc3d9f1A6A3f1cE) |
