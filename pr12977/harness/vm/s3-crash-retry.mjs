// S3: the maintenance process dies inside `complete` (SIGKILL while its holder-clear UPDATE is held by a trigger); retry the same file.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import * as L from './lib.mjs';
const { d } = L;
const tag = process.argv[2] ?? 's3';
const pausedTable = process.argv[3] ?? 'lease'; // lease | binding
L.openLog(tag);
const say = L.say;
L.seedWs('a');
say(`== ${tag}: pause point=${pausedTable}; service jar=${L.env().JAR}; maintenance jar=${L.MAINT_JAR}; db=${d.DB}`);
const rig = await L.startHarness(tag);
try {
  const A = await L.shellSession(rig.h, 'ws-a');
  let r = await A.prompt('ESCAPE'); say('A turn 1 "ESCAPE":', L.turnSummary(r));
  const bA = L.binding(A.sessionId); say(L.bstr(bA)); say(L.hstr(L.holder('a')));
  const B = await L.shellSession(rig.h, 'ws-a');
  r = await B.prompt('HELLO bob'); say('B turn 1:', L.turnSummary(r));
  const inspection = JSON.parse(L.sayMaint(`${tag}-inspect`, L.maint(['inspect', bA.id, String(bA.gen)])).result);
  const recoveryId = L.sayMaint(`${tag}-prepare`, L.maint(['prepare', bA.id, String(bA.gen), inspection.holderKey, 'INC-12977 crash drill'])).result.trim();
  // operator stops every writer: registered workers of this binding + the escaped writer
  const handle = d.sql(`SELECT resource_handle_json FROM qwen_runtime_binding WHERE binding_id='${bA.id}'`)[0][0];
  const reg = L.registrations().find((x) => x.handle && handle.includes(JSON.parse(x.handle).resourceId));
  say(`registered worker pid=${reg?.pid} state=${reg?.state}; escaped writer ${L.escapedPids().join(',')}`);
  for (const pid of [reg.pid, ...L.escapedPids()]) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  await L.sleep(1500);
  const ev = L.writeEvidence('evidence-crash.json', recoveryId);
  // pause the step, then kill the maintenance JVM while it waits
  const trigger = pausedTable === 'lease'
    ? `CREATE TRIGGER rig_pause BEFORE UPDATE ON managed_workspace_execution_lease FOR EACH ROW SET @rig = IF(NEW.holder_key IS NULL AND OLD.holder_key IS NOT NULL, SLEEP(25), 0)`
    : `CREATE TRIGGER rig_pause BEFORE UPDATE ON qwen_runtime_binding FOR EACH ROW SET @rig = IF(NEW.binding_state = 'RELEASED' AND OLD.binding_state <> 'RELEASED', SLEEP(25), 0)`;
  d.sql(trigger);
  const e = { ...process.env };
  const args = ['-jar', L.MAINT_JAR, 'complete', recoveryId, ev];
  // same environment as L.maint()
  const envs = { PATH: '/opt/qwen/bin:/usr/local/bin:/usr/bin:/bin', SPRING_DATASOURCE_URL: `jdbc:mysql://127.0.0.1:3306/${d.DB}?allowPublicKeyRetrieval=true&useSSL=false`,
    SPRING_DATASOURCE_USERNAME: 'root', SPRING_DATASOURCE_PASSWORD: 'rootpw', QWEN_MANAGED_AGENT_RUNTIME_STATE_DIRECTORY: L.stateDir(),
    QWEN_MANAGED_AGENT_RUNTIME_DURABLE_LOCAL_PROCESS: 'true', QWEN_MANAGED_AGENT_RUNTIME_PROVISIONER: 'local-process', QWEN_MANAGED_AGENT_RUNTIME_OPERATOR_RECOVERY_ENABLED: 'true',
    QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY_ID: 'rig', QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY: '<rig-credential-key>' };
  void e;
  const t0 = Date.now();
  const child = spawn('/opt/qwen/jdk/bin/java', args, { env: envs, stdio: ['ignore', 'pipe', 'pipe'], cwd: '/tmp' });
  let out = ''; child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', (c) => { out += c; });
  let held = false;
  for (let i = 0; i < 400 && !held; i++) {
    const rows = d.sql(`SELECT COUNT(*) FROM performance_schema.processlist WHERE STATE = 'User sleep' AND DB = '${d.DB}'`);
    held = rows[0][0] !== '0'; if (!held) await L.sleep(100);
  }
  say(`maintenance JVM pid=${child.pid} reached the paused ${pausedTable} update after ${Date.now() - t0} ms: ${held}`);
  say(`before the crash: ${L.bstr(L.binding(A.sessionId))}; ${L.hstr(L.holder('a'))}`);
  say(L.astr());
  child.kill('SIGKILL');
  await new Promise((res) => child.on('exit', res));
  say(`maintenance JVM killed (SIGKILL); its output ended with: ${out.trim().split('\n').filter((l) => !/INFO|WARN/.test(l)).slice(-1)[0] ?? ''}`);
  d.sql('DROP TRIGGER rig_pause');
  await L.sleep(26000); // let MySQL finish the orphaned statement's sleep and roll back / commit
  say(`after the crash: ${L.bstr(L.binding(A.sessionId))}; ${L.hstr(L.holder('a'))}`);
  say(L.astr());
  r = await B.prompt('HELLO bob'); say('B turn after crash:', L.turnSummary(r));
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = L.sayMaint(`${tag}-complete-retry-${attempt}`, L.maint(['complete', recoveryId, ev]));
    say(`  after retry ${attempt}: ${L.bstr(L.binding(A.sessionId))}; ${L.hstr(L.holder('a'))}`);
    if (res.code === 0) break;
    await L.sleep(12000);
  }
  say(L.astr());
  for (const x of L.executions(bA.id)) say('  execution', x.join(' | '));
  r = await B.prompt('HELLO bob'); say('B turn after completion:', L.turnSummary(r));
  r = await A.prompt('HELLO alice'); say('A turn after completion:', L.turnSummary(r));
  say(`shell calls: ${JSON.stringify(L.shellCalls('a'))}`);
} catch (err) { say('!! script error', err.stack); }
finally { try { d.sql('DROP TRIGGER IF EXISTS rig_pause'); } catch { /* none */ } await rig.stop(); say(`== ${tag} end`); }
