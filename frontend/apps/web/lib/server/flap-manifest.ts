import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {parseFlapManifest, type FlapManifest} from '../flap-manifest';

export {executionAsset, flapManifestSchema, parseFlapManifest, type FlapManifest} from '../flap-manifest';

export async function loadFlapManifest(chainId = 97): Promise<FlapManifest> {
  if (chainId !== 97) throw Error('unsupported Flap chain');
  const file = path.join(process.cwd(), 'public', 'deployments', String(chainId), 'flap.json');
  return parseFlapManifest(JSON.parse(await readFile(file, 'utf8')) as unknown);
}
