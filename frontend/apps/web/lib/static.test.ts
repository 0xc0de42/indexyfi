import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {describe, expect, it} from 'vitest';

const web = join(__dirname, '..');
const roots = ['app', 'components', 'lib', 'domain', 'data'];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}
const files = roots.flatMap(root => sources(join(web, root)));

describe('transport boundaries', () => {
  it.each([
    ['direct Atlas access', /atlasoracle|push\.atlas/i],
    ['WebSocket transport', /new WebSocket|\/ws\/prices|ws:\/\//],
    ['consensus status claims', /consensusStatus/],
    ['versioned or invented backend paths', /\/backend\/(v1|health|assets|ws)\b|['"`]\/(v1|health)\//],
    ['API keys', /ATLAS_API_KEY|api[_-]?key/i],
    ['demo mode', /NEXT_PUBLIC_DATA_MODE|demo-store|useDemo/],
  ])('has no %s in application code', (_label, pattern) => {
    const offenders = files.filter(path => pattern.test(readFileSync(path, 'utf8'))).map(path => relative(web, path));
    expect(offenders).toEqual([]);
  });

  it('issues /snapshot requests only from the API client', () => {
    const offenders = files.filter(path => /['"]\/snapshot['"?]/.test(readFileSync(path, 'utf8')) && !path.endsWith(join('lib', 'api.ts')));
    expect(offenders.map(path => relative(web, path))).toEqual([]);
  });

  it('calls only GET /snapshot and GET /history', () => {
    const client = readFileSync(join(web, 'lib', 'api.ts'), 'utf8');
    const paths = new Set([...client.matchAll(/['"`](\/[a-z][a-z0-9_/-]*)/g)].map(match => match[1]).filter(path => !path.startsWith('/backend')));
    expect([...paths].sort()).toEqual(['/history', '/snapshot']);
  });

  it('constructs the poller only in the app-level provider', () => {
    const offenders = files.filter(path => /new PricePoller/.test(readFileSync(path, 'utf8')) && !path.endsWith(join('lib', 'prices.tsx')));
    expect(offenders.map(path => relative(web, path))).toEqual([]);
  });
});
