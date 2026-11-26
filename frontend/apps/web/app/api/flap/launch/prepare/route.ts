import {handlePrepare} from '@/lib/server/flap-prepare-route';

/** POST /api/flap/launch/prepare — the only server-side Flap launch preparation path (schema: lib/server/flap-prepare.ts). */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handlePrepare(request);
}
