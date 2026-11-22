/**
 * PR 18102 verify harness — mock-free wire oracle for the pre-auth `/artifacts`
 * page route.
 *
 * Drives a real `createServeApp` express app over real HTTP (supertest's
 * ephemeral listener) with a configured bearer token. ARM=head expects the
 * document route to be served pre-auth; ARM=base expects the 401 the PR fixes.
 * Both arms assert the identical security invariants (JSON/POST/trailing
 * segment stay authenticated), so a green pair proves the flip is confined to
 * the document navigation.
 */
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { createServeApp } from './server.js';
import type { ServeOptions } from './types.js';

const ARM = process.env['VERIFY_ARM'] === 'base' ? 'base' : 'head';
const DOC_STATUS = ARM === 'head' ? 200 : 401;
const SHELL_MARKER = '<div id="root">';

const baseOpts: ServeOptions = {
  hostname: '127.0.0.1',
  port: 4170,
  mode: 'http-bridge',
};
const host = `127.0.0.1:${baseOpts.port}`;
const INDEX_HTML =
  '<!doctype html><html><head><title>Qwen Code Web terminal</title>' +
  '<script type="module" src="/assets/app.js"></script></head>' +
  '<body><div id="root"></div></body></html>';

let webShellDir = '';

beforeAll(async () => {
  webShellDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'qwen-verify-18102-'));
  await fsp.writeFile(path.join(webShellDir, 'index.html'), INDEX_HTML);
  await fsp.mkdir(path.join(webShellDir, 'assets'));
  await fsp.writeFile(
    path.join(webShellDir, 'assets', 'app.js'),
    'export const x = 1;\n',
  );
});

afterAll(async () => {
  if (webShellDir)
    await fsp.rm(webShellDir, { recursive: true, force: true });
});

function makeApp() {
  return createServeApp({ ...baseOpts, token: 'secret' }, undefined, {
    webShellDir,
  });
}

function note(cell: string, status: number, extra = '') {
  console.log(`CELL ${cell} status=${status}${extra ? ` ${extra}` : ''}`);
}

describe(`pre-auth /artifacts document route (arm=${ARM})`, () => {
  it('control: /settings document navigation is served (both arms)', async () => {
    const res = await supertest(makeApp())
      .get('/settings')
      .set('Host', host)
      .set('Accept', 'text/html');
    note('control-settings', res.status);
    expect(res.status).toBe(200);
    expect(res.text).toContain(SHELL_MARKER);
  });

  it(`treatment: GET /artifacts document navigation -> ${DOC_STATUS}`, async () => {
    const res = await supertest(makeApp())
      .get('/artifacts')
      .set('Host', host)
      .set('Accept', 'text/html');
    note('artifacts-doc', res.status);
    expect(res.status).toBe(DOC_STATUS);
    if (DOC_STATUS === 200) expect(res.text).toContain(SHELL_MARKER);
  });

  it(`treatment: GET /artifacts/ trailing slash -> ${DOC_STATUS}`, async () => {
    const res = await supertest(makeApp())
      .get('/artifacts/')
      .set('Host', host)
      .set('Accept', 'text/html');
    note('artifacts-trailing-slash', res.status);
    expect(res.status).toBe(DOC_STATUS);
  });

  it(`treatment: GET /ARTIFACTS case-insensitive -> ${DOC_STATUS}`, async () => {
    const res = await supertest(makeApp())
      .get('/ARTIFACTS')
      .set('Host', host)
      .set('Accept', 'text/html');
    note('artifacts-uppercase', res.status);
    expect(res.status).toBe(DOC_STATUS);
  });

  it(`treatment: HEAD /artifacts -> ${DOC_STATUS}`, async () => {
    const res = await supertest(makeApp())
      .head('/artifacts')
      .set('Host', host)
      .set('Accept', 'text/html');
    note('artifacts-head', res.status);
    expect(res.status).toBe(DOC_STATUS);
    if (DOC_STATUS === 200)
      expect(String(res.headers['content-type'])).toMatch(/text\/html/);
  });

  it(`treatment: sec-fetch-mode navigate (Accept */*) -> ${DOC_STATUS}`, async () => {
    const res = await supertest(makeApp())
      .get('/artifacts')
      .set('Host', host)
      .set('Accept', '*/*')
      .set('Sec-Fetch-Mode', 'navigate');
    note('artifacts-sec-fetch-navigate', res.status);
    expect(res.status).toBe(DOC_STATUS);
  });

  it(`treatment: GET /artifacts (Sec-Fetch-Dest: document) -> ${DOC_STATUS}`, async () => {
    const res = await supertest(makeApp())
      .get('/artifacts')
      .set('Host', host)
      .set('Accept', '*/*')
      .set('Sec-Fetch-Dest', 'document');
    note('artifacts-sec-fetch-dest', res.status);
    expect(res.status).toBe(DOC_STATUS);
  });

  it('security: GET /artifacts Accept application/json -> 401 (both arms)', async () => {
    const res = await supertest(makeApp())
      .get('/artifacts')
      .set('Host', host)
      .set('Accept', 'application/json');
    note('artifacts-json', res.status);
    expect(res.status).toBe(401);
  });

  it('security: GET /artifacts/data -> 401 (both arms)', async () => {
    const res = await supertest(makeApp())
      .get('/artifacts/data')
      .set('Host', host)
      .set('Accept', 'application/json');
    note('artifacts-data-json', res.status);
    expect(res.status).toBe(401);
  });

  it('security: GET /artifacts%2fdata -> 401 (both arms)', async () => {
    const res = await supertest(makeApp())
      .get('/artifacts%2fdata')
      .set('Host', host)
      .set('Accept', 'application/json');
    note('artifacts-encoded-json', res.status);
    expect(res.status).toBe(401);
  });

  it('security: POST /artifacts document-shaped -> 401 (both arms)', async () => {
    const res = await supertest(makeApp())
      .post('/artifacts')
      .set('Host', host)
      .set('Accept', 'text/html');
    note('artifacts-post', res.status);
    expect(res.status).toBe(401);
  });

  it('security: decoy sibling /artifacts-extra -> 401 (both arms)', async () => {
    const res = await supertest(makeApp())
      .get('/artifacts-extra')
      .set('Host', host)
      .set('Accept', 'text/html');
    note('artifacts-extra', res.status);
    expect(res.status).toBe(401);
  });

  it('security: authenticated JSON GET /artifacts never returns the shell (both arms)', async () => {
    const res = await supertest(makeApp())
      .get('/artifacts')
      .set('Host', host)
      .set('Accept', 'application/json')
      .set('Authorization', 'Bearer secret');
    note('artifacts-authenticated-json', res.status);
    expect(res.status).toBe(404);
    expect(res.text ?? '').not.toContain(SHELL_MARKER);
  });

  it('control: GET /goals Accept application/json -> 401 (both arms)', async () => {
    const res = await supertest(makeApp())
      .get('/goals')
      .set('Host', host)
      .set('Accept', 'application/json');
    note('goals-json', res.status);
    expect(res.status).toBe(401);
  });

  it('security: GET /artifacts/data/secret (deep decoy) -> 401 (both arms)', async () => {
    const res = await supertest(makeApp())
      .get('/artifacts/data/secret')
      .set('Host', host)
      .set('Accept', 'application/json');
    note('artifacts-data-secret', res.status);
    expect(res.status).toBe(401);
  });

  it('control: authenticated document GET /artifacts served via post-auth fallback (both arms)', async () => {
    const res = await supertest(makeApp())
      .get('/artifacts')
      .set('Host', host)
      .set('Accept', 'text/html')
      .set('Authorization', 'Bearer secret');
    note('artifacts-authenticated-doc', res.status);
    expect(res.status).toBe(200);
    expect(res.text).toContain(SHELL_MARKER);
  });

  it(`treatment: deferred-runtime discriminator isPreAuthWebShellRequest -> ${ARM === 'head' ? 'true' : 'false'}`, async () => {
    const { isPreAuthWebShellRequest } = await import('./web-shell-preauth.js');
    const req = {
      method: 'GET',
      path: '/artifacts',
      headers: { accept: 'text/html' },
    } as never;
    expect(isPreAuthWebShellRequest(req)).toBe(ARM === 'head');
  });
});
