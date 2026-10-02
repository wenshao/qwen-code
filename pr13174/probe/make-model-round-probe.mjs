// VERIFICATION RIG ONLY (PR #13174): derive scripts/probe-model-round.ts from the PR's runner.
// Session-failover + --harness-only, but the Harness is killed while Turn 2's model round is
// still streaming (no tool). Then Turn 3 and Turn 4 are submitted on the same Session and every
// outcome is printed instead of asserted.
import { readFileSync, writeFileSync } from 'node:fs';
const [src, dst] = process.argv.slice(2);
let s = readFileSync(src, 'utf8');
function rep(anchor, replacement) {
  const n = s.split(anchor).length - 1;
  if (n !== 1) throw new Error(`anchor found ${n}x: ${anchor.slice(0, 90)}`);
  s = s.replace(anchor, replacement);
}
rep('let acceptReplacementContinuation = false;', `let acceptReplacementContinuation = false;
const probeModelRoundMarker = 'PROBE_MODEL_ROUND_TURN';
const probeLaterMarker = 'PROBE_LATER_TURN';
let probeModelRoundReleased = false;
let releaseProbeModelRound = () => {};
const probeModelRoundHold = new Promise<void>((resolve) => {
  releaseProbeModelRound = resolve;
});
const probeTurnSql = (filter: string) =>
  \`SELECT turn_id, status, IFNULL(error_code,'-'), submission_attempted, IF(harness_event_epoch IS NULL,'no-epoch','epoch'), IFNULL(LEFT(error_message,160),'-') FROM qwen_managed_agent.managed_agent_turn WHERE \${filter} ORDER BY created_at\`;`);
rep('      if (serialized.includes(failoverSecondMarker)) {', `      if (serialized.includes(probeLaterMarker)) {
        return { content: 'LATER_TURN_OK' };
      }
      if (serialized.includes(probeModelRoundMarker)) {
        if (!probeModelRoundReleased) {
          return {
            contentChunks: ['MODEL_ROUND_PARTIAL'],
            holdAfterChunks: 1,
            holdUntil: probeModelRoundHold,
          };
        }
        return { content: 'MODEL_ROUND_REISSUED' };
      }
      if (serialized.includes(failoverSecondMarker)) {`);
rep(`    if (freeze) {
      // Freeze the writer side only`, `    {
      const r = await fetch(\`\${springUrl}/v1/agents/sessions/\${session.id}/events\`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': \`probe-mr-\${Date.now()}\`, ...tenantHeaders(tenant) },
        body: JSON.stringify({ type: 'agent.session.input.message', input: [{ type: 'text', text: \`\${probeModelRoundMarker}. Reply with anything.\` }] }),
      });
      if (r.status !== 202) throw new Error(\`probe Turn 2 submit returned \${r.status}: \${await r.text()}\`);
      await waitUntil('Model round reached the model', async () => (fake?.requests ?? []).some(({ body }) => JSON.stringify(body['messages']).includes(probeModelRoundMarker)), 60_000, harness);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      console.log(JSON.stringify({ probe: 'before-crash', firstBootId, turns: runMysql(mysqlPort, probeTurnSql(sessionFilter)) }, null, 2));
    }
    if (freeze) {
      // Freeze the writer side only`);
rep(`    releaseContinuationHold();
    await heldStartProxy?.close();`, `    releaseContinuationHold();
    probeModelRoundReleased = true;
    releaseProbeModelRound();
    await heldStartProxy?.close();`);
rep(`    } else {
      const secondResponse = await fetch(`, `    } else if (sessionFailover) {
      const submit = async (marker: string, label: string) => {
        const r = await fetch(\`\${replacementSpringUrl}/v1/agents/sessions/\${session.id}/events\`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': \`probe-\${label}-\${Date.now()}\`, ...tenantHeaders(tenant) },
          body: JSON.stringify({ type: 'agent.session.input.message', input: [{ type: 'text', text: \`\${marker} \${label}. Reply exactly LATER_TURN_OK.\` }] }),
        });
        return { status: r.status, body: (await r.text()).slice(0, 300) };
      };
      const report = (label: string, started: number, result: { events: PublicEvent[]; lastSequence: number } | string) => {
        const terminal = typeof result === 'string' ? undefined : result.events.find((event) => event.terminal);
        console.log(JSON.stringify({
          probe: label,
          elapsedMs: Date.now() - started,
          terminal: typeof result === 'string' ? result : terminal?.type,
          terminalEvent: terminal,
          text: typeof result === 'string' ? '' : result.events.filter((e) => e.type === 'item.output_text.delta').map((e) => eventText(e)).join(''),
          harnessBootId: runMysql(mysqlPort, \`SELECT harness_boot_id FROM qwen_managed_agent.managed_agent_session WHERE \${sessionFilter}\`),
          journalHead: runMysql(mysqlPort, \`SELECT writer_generation, journal_revision, committed_sequence FROM qwen_managed_agent.qwen_managed_session_journal_head WHERE \${sessionFilter}\`),
          turns: runMysql(mysqlPort, probeTurnSql(sessionFilter)),
        }, null, 2));
      };
      const wait = async (after: number) => {
        try {
          return await waitForTerminal(replacementSpringUrl, tenant, session.id, after, replacementSpring, Number(process.env['PROBE_TURN_TIMEOUT_MS'] ?? '150000'));
        } catch (error) {
          return \`no terminal: \${String(error).slice(0, 200)}\`;
        }
      };
      let started = Date.now();
      const turn2 = await wait(firstTurnLastSequence);
      report('turn2-after-harness-restart', started, turn2);
      let after = typeof turn2 === 'string' ? firstTurnLastSequence : turn2.lastSequence;
      for (const label of ['turn3', 'turn4']) {
        started = Date.now();
        const submitted = await submit(probeLaterMarker, label);
        console.log(JSON.stringify({ probe: \`\${label}-submit\`, ...submitted }));
        const result = await wait(after);
        report(label, started, result);
        if (typeof result !== 'string') after = result.lastSequence;
      }
      console.log(JSON.stringify({
        probe: 'model-requests',
        modelRoundRequests: (fake?.requests ?? []).filter(({ body }) => JSON.stringify(body['messages']).includes(probeModelRoundMarker) && !JSON.stringify(body['messages']).includes(probeLaterMarker)).length,
        laterRequests: (fake?.requests ?? []).filter(({ body }) => JSON.stringify(body['messages']).includes(probeLaterMarker)).length,
      }));
      console.log(\`--- replacement Harness log tail ---\\n\${replacementHarness.log().slice(-4000)}\`);
      console.log(\`--- Spring log (filtered) ---\\n\${spring.log().split('\\n').filter((l) => /terminal|declin|recovery|generation|Managed Turn/i.test(l)).slice(-40).join('\\n')}\`);
    } else {
      const secondResponse = await fetch(`);
rep("const workspaceTurns = inflightFailover || continuationFailover;", "const workspaceTurns = inflightFailover || continuationFailover || process.env['PROBE_WORKSPACE'] === '1';");
writeFileSync(dst, s);
console.log('probe written', dst, s.length);
