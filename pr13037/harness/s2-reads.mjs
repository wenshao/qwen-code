// s2: byte-read HTTP semantics + authorization matrix against sessions produced by s1.
// usage: FROM=s1a node s2-reads.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import * as L from './lib.mjs';

const FROM = process.env.FROM ?? 's1a';
L.openLog(`s2-${FROM}`);
const s1 = JSON.parse(fs.readFileSync(`${L.R}/out/${FROM}.json`, 'utf8'));
const sessionOf = (name) => s1.find((r) => r.case === name).session;
const MiB = 1024 * 1024;

async function artifactsOf(session) {
  const list = await L.api('GET', `/v1/agents/sessions/${session}/artifacts?limit=50`);
  return Object.fromEntries((list.json.data ?? []).map((e) => [e.artifact.stream_role, e.artifact]));
}
const results = [];
function check(name, got, want) {
  const ok = Object.entries(want).every(([k, v]) => (typeof v === 'function' ? v(got[k]) : got[k] === v));
  results.push({ name, ok, got });
  L.say(ok ? 'PASS' : 'FAIL', `${name} -> ${JSON.stringify(got)}`);
}

// expected bytes of the 40 MiB stdout
const dir = fs.mkdtempSync(`${L.R}/run/exp-`);
execFileSync('/bin/bash', ['-c', `${L.NODE22} ${L.R}/gen.mjs multi ${40 * MiB} ${MiB} 7 > ${dir}/so 2> ${dir}/se; true`]);
const so = fs.readFileSync(`${dir}/so`);
const multi = sessionOf('multi');
const m = await artifactsOf(multi);
const A = m.stdout;
const size = A.byte_length;
L.say('artifact', { id: A.id, size, revision: A.revision });

const rd = async (name, opts, want, slice) => {
  const r = await L.content(multi, A.id, { revision: A.revision, ...opts });
  const got = { status: r.status, code: r.code, len: r.body.length, range: r.headers['content-range'], etag: r.headers.etag === `"${A.sha256}"` ? 'strong-sha' : r.headers.etag };
  if (slice) got.bytesEqual = Buffer.compare(r.body, so.subarray(slice[0], slice[1])) === 0;
  check(name, got, want);
  return r;
};

// --- full representation headers
const full = await L.content(multi, A.id, { revision: A.revision });
check('full 200 headers', { status: full.status, ...full.headers, sha: L.sha256(full.body) === A.sha256 }, {
  status: 200,
  'content-type': 'application/octet-stream',
  'content-length': String(size),
  etag: `"${A.sha256}"`,
  'accept-ranges': 'bytes',
  'cache-control': (v) => /private/.test(v) && /no-store/.test(v),
  'x-content-type-options': 'nosniff',
  'content-disposition': (v) => /^attachment/.test(v),
  'repr-digest': `sha-256=:${Buffer.from(A.sha256, 'hex').toString('base64')}:`,
  'content-encoding': undefined,
  sha: true,
});
// --- ranges
await rd('range across segment 0/1 boundary', { range: `bytes=${MiB - 6}-${MiB + 9}` }, { status: 206, len: 16, range: `bytes ${MiB - 6}-${MiB + 9}/${size}`, bytesEqual: true }, [MiB - 6, MiB + 10]);
await rd('range spanning 3 segments (exactly 1 MiB, unaligned)', { range: `bytes=${5 * MiB - 100}-${6 * MiB - 101}` }, { status: 206, len: MiB, bytesEqual: true }, [5 * MiB - 100, 6 * MiB - 100]);
await rd('first byte', { range: 'bytes=0-0' }, { status: 206, len: 1, range: `bytes 0-0/${size}`, bytesEqual: true }, [0, 1]);
await rd('last byte', { range: `bytes=${size - 1}-${size - 1}` }, { status: 206, len: 1, bytesEqual: true }, [size - 1, size]);
await rd('suffix 10', { range: 'bytes=-10' }, { status: 206, len: 10, range: `bytes ${size - 10}-${size - 1}/${size}`, bytesEqual: true }, [size - 10, size]);
await rd('open-ended near EOF', { range: `bytes=${size - 40}-` }, { status: 206, len: 40, bytesEqual: true }, [size - 40, size]);
await rd('end past EOF is capped', { range: `bytes=${size - 10}-99999999999` }, { status: 206, len: 10, bytesEqual: true }, [size - 10, size]);
await rd('start at EOF', { range: `bytes=${size}-${size + 10}` }, { status: 416, code: 'range_not_satisfiable', range: `bytes */${size}` });
await rd('suffix 0', { range: 'bytes=-0' }, { status: 416, range: `bytes */${size}` });
await rd('1 MiB + 1', { range: `bytes=0-${MiB}` }, { status: 400, code: 'range_too_large' });
await rd('open-ended from 0 (whole 40 MiB)', { range: 'bytes=0-' }, { status: 400, code: 'range_too_large' });
await rd('multiple ranges', { range: 'bytes=0-1,5-6' }, { status: 400, code: 'unsupported_range' });
for (const bad of ['bytes=abc', 'bytes=5-2', 'items=0-5', 'bytes=-', 'bytes=1.5-2', 'bytes= 0-1x']) await rd(`malformed "${bad}"`, { range: bad }, { status: 400, code: 'invalid_range' });
// --- revision / validators
check('no revision', await (async () => { const r = await L.content(multi, A.id, {}); return { status: r.status, code: r.code }; })(), { status: 400, code: 'revision_required' });
check('unknown revision', await (async () => { const r = await L.content(multi, A.id, { revision: '0'.repeat(64) }); return { status: r.status, code: r.code, len: r.body.length < 400 }; })(), { status: 404, code: 'artifact_not_found' });
await rd('If-Match wrong', { ifMatch: `"${'1'.repeat(64)}"`, range: 'bytes=0-9' }, { status: 412, code: 'artifact_revision_mismatch' });
await rd('If-Match right', { ifMatch: `"${A.sha256}"`, range: 'bytes=0-9' }, { status: 206, len: 10, bytesEqual: true }, [0, 10]);
await rd('If-Match list with *', { ifMatch: `"x", *`, range: 'bytes=0-9' }, { status: 206, len: 10 });
await rd('If-Match weak validator', { ifMatch: `W/"${A.sha256}"`, range: 'bytes=0-9' }, { status: 412 });
await rd('If-Range match keeps the range', { ifRange: `"${A.sha256}"`, range: 'bytes=0-9' }, { status: 206, len: 10 });
const ifr = await L.content(multi, A.id, { revision: A.revision, ifRange: `"${'2'.repeat(64)}"`, range: 'bytes=0-9' });
check('If-Range mismatch selects the full representation', { status: ifr.status, len: ifr.body.length, sha: L.sha256(ifr.body) === A.sha256 }, { status: 200, len: size, sha: true });
// --- empty stream
const empty = sessionOf('empty');
const e = await artifactsOf(empty);
const ef = await L.content(empty, e.stderr.id, { revision: e.stderr.revision });
check('empty stderr full', { status: ef.status, len: ef.body.length, cl: ef.headers['content-length'], etag: ef.headers.etag }, { status: 200, len: 0, cl: '0', etag: `"${e.stderr.sha256}"` });
const er = await L.content(empty, e.stderr.id, { revision: e.stderr.revision, range: 'bytes=0-0' });
check('empty stderr any range', { status: er.status, range: er.headers['content-range'] }, { status: 416, range: 'bytes */0' });
// --- blocked / not-started results expose facts but no download
for (const name of ['notstarted', 'partial']) {
  const s = sessionOf(name);
  const list = await L.api('GET', `/v1/agents/sessions/${s}/artifacts`);
  check(`${name}: no artifacts`, { status: list.status, count: list.json.data?.length, more: list.json.has_more }, { status: 200, count: 0 });
}
// --- authorization precedence (before range / revision disclosure)
const meta = (actor, tenant) => L.api('GET', `/v1/agents/sessions/${multi}/artifacts/${A.id}`, undefined, { actor, tenant });
const auth = async (name, opts, want) => {
  const md = await meta(opts.actor, opts.tenant ?? L.TENANT);
  const c = await L.content(multi, A.id, { revision: A.revision, range: 'bytes=0-9', ...opts });
  const bad = await L.content(multi, A.id, { revision: A.revision, range: 'bytes=zzz', ...opts });
  const norev = await L.content(multi, A.id, { ...opts });
  const tr = await L.api('GET', `/v1/agents/sessions/${multi}/artifacts`, undefined, { actor: opts.actor, tenant: opts.tenant ?? L.TENANT });
  check(name, { metadata: `${md.status} ${md.json.error?.code ?? ''}`.trim(), list: tr.status, content: `${c.status} ${c.code ?? ''}`.trim(), malformedRange: `${bad.status} ${bad.code ?? ''}`.trim(), noRevision: `${norev.status} ${norev.code ?? ''}`.trim(), leaked: c.body.length > 400 || !!c.headers['content-range'] || !!c.headers.etag }, want);
};
await auth('alice (granted)', { actor: 'alice' }, { metadata: '200', content: '206', malformedRange: '400 invalid_range', leaked: true });
await auth('no actor, tenant header only', { actor: null }, { metadata: (v) => /^40[134]/.test(v), content: (v) => /^40[134]/.test(v), malformedRange: (v) => /^40[134]/.test(v) && !/range/.test(v), noRevision: (v) => !/revision/.test(v), leaked: false });
await auth('bob (no Workspace grant)', { actor: 'bob' }, { metadata: (v) => /^404/.test(v), content: (v) => /^404/.test(v), malformedRange: (v) => /^404/.test(v), noRevision: (v) => /^404/.test(v), leaked: false });
await auth('alice in another tenant', { actor: 'alice', tenant: 't-other' }, { metadata: (v) => /^404/.test(v), content: (v) => /^404/.test(v), malformedRange: (v) => /^404/.test(v), leaked: false });
// cross-session: artifact id of `multi` requested under another readable session
const other = sessionOf('ok');
const cross = await L.content(other, A.id, { revision: A.revision, range: 'bytes=0-9' });
check('artifact id under another Session', { status: cross.status, code: cross.code }, { status: 404, code: 'artifact_not_found' });
const crossMeta = await L.api('GET', `/v1/agents/sessions/${other}/artifacts/${A.id}`);
check('artifact metadata under another Session', { status: crossMeta.status }, { status: 404 });

const failed = results.filter((r) => !r.ok);
L.say('summary', `${results.length - failed.length}/${results.length} as expected${failed.length ? '; unexpected: ' + failed.map((f) => f.name).join(' | ') : ''}`);
L.out(`s2-${FROM}.json`, results);
