import {NextResponse} from 'next/server';
import {loadFlapManifest} from './flap-manifest';
import {FlapPrepareError, parseFlapPrepareInput, prepareFlapLaunch, type PrepareDeps} from './flap-prepare';

const noStore = {'Cache-Control': 'no-store'};

/** Handler with injectable dependencies (tests); see lib/server/flap-prepare.ts for the request/response schema. */
export async function handlePrepare(request: Request, deps: PrepareDeps & {loadManifest?: typeof loadFlapManifest} = {}) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({error: 'invalid_json', message: 'request body is not valid JSON'}, {status: 400, headers: noStore});
  }
  try {
    const input = parseFlapPrepareInput(body);
    let manifest;
    try {
      manifest = await (deps.loadManifest ?? loadFlapManifest)(input.chainId);
    } catch (error) {
      throw new FlapPrepareError('flap_unavailable', error instanceof Error ? error.message : 'Flap manifest unavailable');
    }
    return NextResponse.json(await prepareFlapLaunch(input, manifest, deps), {headers: noStore});
  } catch (error) {
    if (error instanceof FlapPrepareError) return NextResponse.json({error: error.code, message: error.message}, {status: error.status, headers: noStore});
    return NextResponse.json({error: 'invalid_request', message: error instanceof Error ? error.message : 'Flap preparation failed'}, {status: 400, headers: noStore});
  }
}
