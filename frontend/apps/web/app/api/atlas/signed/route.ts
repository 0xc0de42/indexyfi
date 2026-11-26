// GET /api/atlas/signed?feeds=751,632,956 -> {payloads, signatures}
// Server-side proxy to the Atlas Pull API with signed=true. The Atlas key lives in the server-only ATLAS_API_KEY
// (never a public, browser-exposed variable); the browser only receives Atlas-signed payloads, which the oracle
// contract verifies on chain.
import {NextResponse} from 'next/server';
import {parseFeedIds} from '@/lib/atlas-signed';
import {fetchAtlasSigned} from '@/lib/server/atlas-pull';

export const dynamic = 'force-dynamic';

const noStore = {'Cache-Control': 'no-store'};

export async function GET(request: Request) {
  let feeds: number[];
  try {
    feeds = parseFeedIds(new URL(request.url).searchParams.get('feeds'));
  } catch (err) {
    return NextResponse.json({error: 'invalid_feeds', message: err instanceof Error ? err.message : 'invalid feeds'}, {status: 400, headers: noStore});
  }
  const key = process.env.ATLAS_API_KEY;
  if (!key) return NextResponse.json({error: 'atlas_key_missing', message: 'ATLAS_API_KEY is not configured on the server'}, {status: 503, headers: noStore});
  try {
    const prices = await fetchAtlasSigned(feeds, key);
    return NextResponse.json(prices, {headers: noStore});
  } catch (err) {
    return NextResponse.json({error: 'atlas_unavailable', message: err instanceof Error ? err.message : 'Atlas unavailable'}, {status: 502, headers: noStore});
  }
}
