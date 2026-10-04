// Checks each factual claim #13347 writes into the docs and the OpenAPI
// against code and git objects, at head (and base where the claim is a delta).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const REPO = process.env.REPO ?? '/Users/wenshao/git/pr13347-head';
const BASE = '2c591ecc08a6fa080342f9b1b9f7f43215178cbb';
const HEAD = 'HEAD';
const git = (...a) => { try { return execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { if (a[0] === 'grep' && e.status === 1) return ''; throw e; } };
const show = (rev, p) => git('show', `${rev}:${p}`);
const SPEC = 'packages/sdk-java/managed-agent-server/src/main/resources/openapi/managed-agent-public-api.openapi.json';
const J = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/';
const rows = [];
const check = (id, claim, ok, evidence) => rows.push({ id, claim, ok, evidence });

const spec = { base: JSON.parse(show(BASE, SPEC)), head: JSON.parse(show(HEAD, SPEC)) };
const ops = (s) => Object.entries(s.paths).flatMap(([p, item]) => Object.entries(item)
  .filter(([m]) => ['get', 'post', 'put', 'delete', 'patch'].includes(m)).map(([m, o]) => ({ p, m, ...o })));
const taskOps = (s) => ops(s).filter((o) => /task/i.test(o.operationId));
const status = (o) => o['x-qwen-implementation-status'];

// C1: four read routes partial, events and cancel planned.
const t = taskOps(spec.head).map((o) => `${o.operationId}=${status(o)}`);
const reads = ['listSessionTasks', 'getSessionTask', 'queryWebShellTasks', 'getWebShellTask'];
check('C1', 'Four task read routes are `partial`; events and cancel stay `planned`',
  reads.every((id) => t.includes(`${id}=partial`)) && taskOps(spec.head).filter((o) => !reads.includes(o.operationId)).every((o) => status(o) === 'planned'),
  t.join(', '));

// C2: which operations describe 400 unsupported_feature, base vs head.
const uf = (s) => ops(s).filter((o) => JSON.stringify(o).includes('unsupported_feature')).map((o) => `${o.operationId}(${status(o)})`);
check('C2', '`400 unsupported_feature` is documented only on still-planned task routes',
  uf(spec.head).filter((x) => /Task/.test(x)).every((x) => x.endsWith('(planned)')),
  `base: ${uf(spec.base).filter((x) => /Task/.test(x)).join(', ')} | head: ${uf(spec.head).filter((x) => /Task/.test(x)).join(', ')}`);
const javaUf = git('grep', '-n', 'unsupported_feature', '--', J).trim().split('\n').filter(Boolean);
check('C3', 'No served task path throws `unsupported_feature`',
  !javaUf.some((l) => /Task/.test(l)),
  `${javaUf.length} hits in main Java: ${javaUf.map((l) => l.split(':').slice(0, 2).join(':').replace(J, '')).join('; ')}`);

// C4: capabilities required on WebShellSession (new here) and PublicSession (already).
const req = (s, n) => (s.components.schemas[n]?.required || []).includes('capabilities');
check('C4', '`WebShellSession.required` gains `capabilities`; public `Session` already required it',
  !req(spec.base, 'WebShellSession') && req(spec.head, 'WebShellSession') && req(spec.base, 'PublicSession'),
  `WebShellSession base=${req(spec.base, 'WebShellSession')} head=${req(spec.head, 'WebShellSession')}; PublicSession base=${req(spec.base, 'PublicSession')}`);
const capsReq = (s, n) => (s.components.schemas[n]?.required || []).includes('tasks');
check('C5', '`capabilities.tasks` is served and required in both capability schemas',
  capsReq(spec.head, 'WebShellSessionCapabilities') && capsReq(spec.head, 'SessionCapabilities'),
  `WebShellSessionCapabilities.required tasks=${capsReq(spec.head, 'WebShellSessionCapabilities')}; SessionCapabilities tasks=${capsReq(spec.head, 'SessionCapabilities')}`);
const svc = show(HEAD, J + 'service/ManagedAgentService.java');
check('C6', '`capabilities.tasks` is a hard-coded `true` at the only WebShellSession construction site',
  /new WebShellSessionCapabilities\(true,/.test(svc) && (svc.match(/new WebShellSessionCapabilities\(/g) || []).length === 1,
  `construction sites=${(svc.match(/new WebShellSessionCapabilities\(/g) || []).length}`);
const planned = (s, n, f) => status(s.components.schemas[n]?.properties?.[f] || {});
check('C7', '`task_id` / `taskId` stay `planned` with cancel',
  planned(spec.head, 'PublicCommandOperation', 'task_id') === 'planned' && planned(spec.head, 'WebShellCommandOperation', 'taskId') === 'planned',
  `PublicCommandOperation.task_id=${planned(spec.head, 'PublicCommandOperation', 'task_id')}; WebShellCommandOperation.taskId=${planned(spec.head, 'WebShellCommandOperation', 'taskId')}`);

// C8: the list description names what the projection can emit.
const kinds = spec.head.components.schemas.TaskKind?.enum || spec.head.components.schemas.PublicTaskKind?.enum;
const proj = show(HEAD, J + 'store/ManagedExtensionProjection.java');
const bodyKinds = [...proj.matchAll(/Body\(\s*"([a-z_]+)"[^;]*?"(monitor|[a-z_]+|null)"/g)].map((m) => m.slice(1).join('->'));
const emitted = [...proj.matchAll(/"(monitor|child_agent|workflow|background_shell|automation)"/g)].map((m) => m[1]);
check('C8', 'List description: Monitor runs are the only task the server projects today',
  new Set(emitted).size === 1 && emitted[0] === 'monitor',
  `TaskKind enum=[${kinds}]; kinds named in ManagedExtensionProjection.java=${[...new Set(emitted)]}`);

// C9: store error codes the authority doc now names.
const models = show(HEAD, J + 'store/ManagedSessionStoreModels.java');
const sstore = show(HEAD, J + 'store/ManagedSessionStore.java');
const inv = (models.match(/ERROR_INVALID_REQUEST\s*=\s*"([^"]+)"/) || [])[1];
const nf = [...new Set([...sstore.matchAll(/"(managed_session_not_found|session_not_found)"/g)].map((m) => m[1]))];
const docEn = show(HEAD, 'docs/design/2026-09-27-managed-extension-authority.md');
check('C9', 'Authority doc names the store codes `invalid_managed_session_store_request` and `managed_session_not_found`',
  inv === 'invalid_managed_session_store_request' && nf.includes('managed_session_not_found') && docEn.includes('400 invalid_managed_session_store_request') && docEn.includes('404 managed_session_not_found'),
  `ERROR_INVALID_REQUEST="${inv}"; ManagedSessionStore codes=${nf}; old strings left in EN doc: ${['managed_session_invalid_request', '404 session_not_found'].filter((s) => docEn.includes(s)).join(',') || 'none'}`);

// C10: the Current-state pin carries the H0b dispatchGeneration paragraph; the old pin did not.
const rc = 'docs/design/2026-09-27-managed-extension-record-contract.md';
const dg = (rev) => (show(rev, rc).match(/dispatchGeneration/g) || []).length;
const projAt = (rev) => { try { git('cat-file', '-e', `${rev}:packages/core/src/managed-runtime/managed-extension-projection.ts`); return true; } catch { return false; } };
const surveyCitesProjection = /managed-extension-projection|ManagedExtensionProjection/.test(docEn.split('## Current state')[1].split('## Goals')[0]);
check('C10', 'Current-state pin `9220c85358` carries the dispatchGeneration paragraph; survey does not cite the projection module',
  dg('9220c85358') > 0 && dg('848cf5e6c4') === 0 && !surveyCitesProjection,
  `dispatchGeneration in record contract: 848cf5e6c4=${dg('848cf5e6c4')} 9220c85358=${dg('9220c85358')}; projection module exists at 9220c85358=${projAt('9220c85358')}; survey cites it=${surveyCitesProjection}; 9220c85358 is ancestor of base=${(() => { try { git('merge-base', '--is-ancestor', '9220c85358', BASE); return true; } catch { return false; } })()}`);

// C11: 33 registered names; generic append accepts the enabled domains that have no Stage H body.
const records = show(HEAD, 'packages/core/src/managed-runtime/managed-session-records.ts');
const arr = (name, text) => { const m = text.match(new RegExp(`${name}[^=]*=\\s*(?:Object\\.freeze\\()?\\[([\\s\\S]*?)\\]`)); return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : null; };
const registered = arr('MANAGED_SESSION_DOMAINS', records) || arr('MANAGED_SESSION_DOMAIN_NAMES', records);
const enabled = arr('MANAGED_SESSION_ENABLED_DOMAINS', records);
const projTs = show(HEAD, 'packages/core/src/managed-runtime/managed-extension-projection.ts');
const bodies = [...(projTs.match(/MANAGED_EXTENSION_RECORD_BODIES[\s\S]*?\n\}\)?;/) || [''])[0].matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]);
const generic = (enabled || []).filter((d) => !bodies.includes(d));
check('C11', 'Generic append narrowed from 33 registered names to the 4 enabled domains with no Stage H body, in defined terms (R1-3)',
  registered?.length === 33 && generic.length === 4 && !/envelope domain/i.test(docEn),
  `registered=${registered?.length}; enabled=${enabled?.length} [${enabled}]; record bodies=${bodies.length} [${bodies}]; generic append accepts=${generic.length} [${generic}]; "envelope domain" hits repo-wide=${git('grep', '-c', '-i', 'envelope domain', '--', 'docs', 'packages').trim().split('\n').filter(Boolean).length} file(s)`);

// C12: CI runs ManagedAgentMySqlIT on MariaDB 10.11 only.
const wf = show(HEAD, '.github/workflows/sdk-java.yml');
const pom = show(HEAD, 'packages/sdk-java/managed-agent-server/pom.xml');
const hostedIncludes = [...pom.matchAll(/<id>(hosted-[a-z-]+)<\/id>[\s\S]*?<includes>([\s\S]*?)<\/includes>/g)].map((m) => `${m[1]}: ${[...m[2].matchAll(/<include>([^<]+)<\/include>/g)].map((x) => x[1]).join(',')}`);
check('C12', 'Validation: ManagedAgentMySqlIT runs in CI on MariaDB 10.11 (not MySQL 8.4)',
  /mariadb:10\.11/.test(wf) && !hostedIncludes.some((l) => /ManagedAgentMySqlIT|\*\*\/\*IT/.test(l)),
  `MariaDB lane image=${(wf.match(/mariadb:[0-9.]+/) || [])[0]} with -Pmysql-integration (Hosted*IT excluded); MySQL 8.4 profiles include only: ${hostedIncludes.join(' | ')}`);

// C13: the record contract's "as has the Java Session store" (R1-5).
const javaRefs = git('grep', '-n', 'managed-extension-record\\.ts', '--', 'packages/sdk-java').trim().split('\n').filter(Boolean);
const rcHead = show(HEAD, rc);
check('C13', 'Record contract states who consumes the TypeScript module without naming the Java store (R1-5)',
  !/as has the Java Session store/.test(rcHead) || javaRefs.some((l) => !/\*|\/\//.test(l.split(':').slice(2).join(':'))),
  `doc says: "${(rcHead.match(/The Session authority's record and projection modules[^\n]*/) || [''])[0]}"; references to managed-extension-record.ts in packages/sdk-java=${javaRefs.length}`);

// C14: language twins changed in lockstep (same line count per pair at head).
const pairs = ['managed-agent-task-contract', 'managed-extension-authority', 'managed-extension-record-contract'];
const lc = (rev, p) => show(rev, p).split('\n').length;
check('C14', 'EN/zh-CN pairs that were line-aligned at base stay aligned; every pair changed on both sides',
  pairs.every((p) => (lc(BASE, `docs/design/2026-09-27-${p}.md`) !== lc(BASE, `docs/design/2026-09-27-${p}.zh-CN.md`)) || lc(HEAD, `docs/design/2026-09-27-${p}.md`) === lc(HEAD, `docs/design/2026-09-27-${p}.zh-CN.md`)) && pairs.every((p) => ['.md', '.zh-CN.md'].every((s) => git('diff', '--name-only', BASE, HEAD, '--', `docs/design/2026-09-27-${p}${s}`).trim() !== '')),
  pairs.map((p) => `${p}: base ${lc(BASE, `docs/design/2026-09-27-${p}.md`)}/${lc(BASE, `docs/design/2026-09-27-${p}.zh-CN.md`)} head ${lc(HEAD, `docs/design/2026-09-27-${p}.md`)}/${lc(HEAD, `docs/design/2026-09-27-${p}.zh-CN.md`)}`).join('; '));

fs.writeFileSync('/Users/wenshao/git/pr13347-rig/results/doc-claims-' + (process.env.TAG ?? 'head') + '.json', JSON.stringify(rows, null, 2));
for (const r of rows) console.log(`${r.ok ? 'HOLDS ' : 'FAILS '} ${r.id} ${r.claim}\n        ${r.evidence}`);
