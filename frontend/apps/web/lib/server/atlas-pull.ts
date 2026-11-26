/**
 * SERVER ONLY. The single place where this app talks to the Atlas Pull API and holds its key
 * (process.env.ATLAS_API_KEY, read by app/api/atlas/signed/route.ts). Never import from client code:
 * lib/static.test.ts enforces that only that route imports this module.
 */
import {hexToBytes, isHex, type Hex} from 'viem';
import {decodeAtlasPayload, FEEDS_PER_PAYLOAD, type SignedPrices} from '../atlas-signed';

export const ATLAS_PULL_URL = 'https://api.atlasoracle.io/report/v1/price/latest';

type AtlasResponse = {data?: {payload?: unknown; signature?: unknown} | null; status?: {error_code?: unknown; error_message?: unknown}};

/**
 * Server side only: one signed Atlas Pull API request per 20 feeds. Errors never include the key.
 * Verifies each payload covers exactly the requested feeds of its chunk.
 */
export async function fetchAtlasSigned(feeds: readonly number[], apiKey: string, fetchImpl: typeof fetch = fetch): Promise<SignedPrices> {
  if (!apiKey) throw Error('Atlas key is not configured');
  const payloads: Hex[] = [], signatures: Hex[] = [];
  for (let i = 0; i < feeds.length; i += FEEDS_PER_PAYLOAD) {
    const chunk = feeds.slice(i, i + FEEDS_PER_PAYLOAD);
    const response = await fetchImpl(ATLAS_PULL_URL, {
      method: 'POST', cache: 'no-store',
      headers: {'X-API-KEY': apiKey, 'Content-Type': 'application/json'},
      body: JSON.stringify({feedIds: chunk.map(String), signed: true}),
    });
    const body = (await response.json().catch(() => ({}))) as AtlasResponse;
    if (!response.ok || body.status?.error_code !== '0') {
      throw Error(`Atlas Pull API error (HTTP ${response.status}${typeof body.status?.error_message === 'string' ? `: ${body.status.error_message}` : ''})`);
    }
    const {payload, signature} = body.data ?? {};
    if (typeof payload !== 'string' || !isHex(payload) || typeof signature !== 'string' || !isHex(signature) || hexToBytes(signature).length !== 65) {
      throw Error('Atlas returned an unsigned or malformed price');
    }
    const covered = new Set(decodeAtlasPayload(payload).map(r => r.feedId));
    if (chunk.some(id => !covered.has(id))) throw Error('Atlas payload does not cover every requested feed');
    payloads.push(payload);
    signatures.push(signature);
  }
  return {payloads, signatures};
}
