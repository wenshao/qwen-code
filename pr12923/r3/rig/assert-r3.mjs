// R3 final scripted assertions over the recorded Web Shell and probe results.
import fs from 'node:fs';
import path from 'node:path';
import { SP } from './lib.mjs';

const j = (p) => JSON.parse(fs.readFileSync(path.join(SP, p), 'utf8'));
const SRC = 'f79ea464005c49df65128e9e58c2e75e2ddda0dcf27b131d4db31c904e693a78';
const results = [];
const check = (id, cond, detail) => {
  results.push({ id, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${id} ${detail ?? ''}`);
};

const bp = j('runs/web-base-paste/result.json');
check('W1-base-toast', bp.outcome === 'error-visible' && /HTTP 413/.test(bp.visibleErrorLines[0] ?? ''), bp.visibleErrorLines[0]);
check('W2-base-no-side-effects', bp.files.length === 0 && bp.modelCalls.length === 0, `files=${bp.files.length} modelCalls=${bp.modelCalls.length}`);

const hp = j('runs/web-head-paste/result.json');
check('W3-head-model-replied', hp.outcome === 'model-replied');
check('W4-head-hashes', hp.files.length === 1 && hp.files[0].sha256 === SRC && hp.browserDownload.sha256 === SRC && hp.modelCalls.find((c) => c.lastUserImages)?.images[0].sha256 === SRC.slice(0, 16));
check('W5-head-chunked-wire', JSON.stringify(hp.faultProxy.filter((e) => /chunks/.test(e.p)).map((e) => e.bytes)) === JSON.stringify([524288, 524288, 524288, 180433]));

const mf = j('runs/web-head-multifail/result.json');
const deletes = mf.faultProxy.filter((e) => e.m === 'DELETE');
check('W6-multifail-cleanup', mf.files.length === 0 && mf.modelCalls.length === 0 && deletes.some((e) => /attachment-uploads\//.test(e.p) && e.status === 204) && deletes.some((e) => /attachments\/image\.png/.test(e.p) && e.status === 200), `deletes=${deletes.length} files=${mf.files.length}`);

const mt = j('runs/web-head-midturn/result.json');
check('W7-midturn-delivered', mt.files.length === 1 && mt.files[0].sha256 === SRC && mt.modelCalls.some((c) => c.lastUserImages > 0 && c.images[0].sha256 === SRC.slice(0, 16)));

const caps = j('runs/probe-caps/result.json');
const head503 = caps.find((c) => c.arm === 'head' && c.fault === '503-once');
const headHtml = caps.find((c) => c.arm === 'head' && c.fault === 'html-200');
const baseBoth = caps.filter((c) => c.arm === 'base');
check('W8-probe-head-fails-then-recovers', !head503.first.ok && !headHtml.first.ok && head503.secondUploadSameClient === 'ok' && headHtml.secondUploadSameClient === 'ok');
check('W9-probe-base-unaffected', baseBoth.every((c) => c.first.ok));

fs.writeFileSync(path.join(SP, 'results', 'assert-r3.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} assertions passed`);
process.exit(failed.length ? 1 : 0);
