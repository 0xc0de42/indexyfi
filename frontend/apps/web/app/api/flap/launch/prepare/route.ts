import {NextResponse} from 'next/server';
import {loadFlapManifest} from '@/lib/server/flap-manifest';
import {prepareFlapLaunch, type FlapPrepareInput} from '@/lib/server/flap-prepare';

export const dynamic = 'force-dynamic';
const noStore = {'Cache-Control': 'no-store'};

export async function POST(request: Request) {
  let input: FlapPrepareInput;
  try {
    input = await request.json() as FlapPrepareInput;
  } catch {
    return NextResponse.json({error: 'invalid_json'}, {status: 400, headers: noStore});
  }
  try {
    const manifest = await loadFlapManifest(input.chainId);
    return NextResponse.json(await prepareFlapLaunch(input, manifest), {headers: noStore});
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Flap preparation failed';
    const unavailable = /ENOENT|manifest/i.test(message);
    return NextResponse.json({error: unavailable ? 'flap_unavailable' : 'invalid_launch', message}, {status: unavailable ? 503 : 400, headers: noStore});
  }
}
