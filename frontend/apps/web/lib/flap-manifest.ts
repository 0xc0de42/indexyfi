/**
 * Flap provider manifest (schema 6), shared by the browser and the server prepare route. Generated from the deployment
 * record by contracts/openfour/scripts/flap-export-manifest.cjs into public/deployments/97/flap.json.
 */
import {getAddress, isAddress, type Address} from 'viem';
import {z} from 'zod';

const address = z.string().refine(value => isAddress(value), 'invalid address').transform(value => getAddress(value));
const asset = z.object({
  address,
  symbol: z.string().min(1),
  decimals: z.number().int().min(0).max(18),
  referenceAssetId: z.string().min(1),
  feedId: z.number().int().positive(),
  isMock: z.boolean().default(false),
  buyPath: z.array(address).min(2).max(4),
  sellPath: z.array(address).min(2).max(4),
});

export const flapManifestSchema = z.object({
  schemaVersion: z.literal(6),
  provider: z.literal('flap-direct-v3'),
  fixture: z.boolean(),
  testAssets: z.boolean().default(false),
  chainId: z.literal(97),
  deploymentBlock: z.number().int().nonnegative(),
  factory: address,
  vaultFactory: address,
  vaultImplementation: address,
  portal: address,
  dockRouter: address,
  guardian: address,
  settlementToken: address,
  settlementDecimals: z.literal(18),
  adapter: address,
  oracle: address,
  router: address,
  tokenImplementation: address,
  cap: z.string().regex(/^\d+$/),
  buyTaxBps: z.number().int().min(0).max(1000),
  sellTaxBps: z.number().int().min(0).max(1000),
  taxDuration: z.number().int().positive(),
  antiFarmerDuration: z.number().int().nonnegative(),
  minimumSeed: z.string().regex(/^\d+$/),
  minimumLiquidity: z.string().regex(/^\d+$/),
  salt: z.object({suffix: z.literal('7777'), lockRequired: z.literal(false)}),
  assets: z.array(asset).min(1).max(66),
});

export type FlapManifest = z.infer<typeof flapManifestSchema>;

export function parseFlapManifest(input: unknown): FlapManifest {
  const manifest = flapManifestSchema.parse(input);
  const tokens = manifest.assets.map(item => item.address.toLowerCase());
  const refs = manifest.assets.map(item => item.referenceAssetId);
  const feeds = manifest.assets.map(item => item.feedId);
  if (new Set(tokens).size !== tokens.length || new Set(refs).size !== refs.length || new Set(feeds).size !== feeds.length) {
    throw Error('duplicate Flap execution asset');
  }
  for (const item of manifest.assets) {
    if (item.buyPath[0] !== manifest.settlementToken || item.buyPath.at(-1) !== item.address) throw Error(`invalid buy path for ${item.symbol}`);
    if (item.sellPath[0] !== item.address || item.sellPath.at(-1) !== manifest.settlementToken) throw Error(`invalid sell path for ${item.symbol}`);
  }
  return manifest;
}


export function executionAsset(manifest: FlapManifest, token: Address) {
  return manifest.assets.find(asset => asset.address.toLowerCase() === token.toLowerCase());
}
