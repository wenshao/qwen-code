// Generates scripts/run-managed-agent-server-e2e.probe.ts from the PR runner by
// fail-closed anchor replacement. Every anchor must match exactly once.
//   PROBE_DIAG=1       print first-turn terminal + streamed delta length
//   PROBE_CORRUPT=part-digest|part-missing|manifest-missing
//                      corrupt one stored chunk row after the first owners die,
//                      send one probe Turn to the cold replacement, record what
//                      happens, restore the exact bytes, then continue the
//                      normal second Turn (full-context restoration check).
import { readFileSync, writeFileSync } from 'node:fs';

const [src, dst] = process.argv.slice(2);
let s = readFileSync(src, 'utf8');

function once(anchor, replacement) {
  const n = s.split(anchor).length - 1;
  if (n !== 1) throw new Error(`anchor matched ${n} times: ${anchor.slice(0, 80)}`);
  s = s.replace(anchor, replacement);
}

// 1. Fake model: a probe Turn that reaches the model is answered distinctly
//    (checked before the first-turn marker, which every later history carries).
once(
  `      if (serialized.includes(failoverFirstMarker)) {
        return bigOutput`,
  `      if (serialized.includes('PROBE_CORRUPT_TURN')) {
        const lastUser = JSON.stringify(messages[messages.length - 1] ?? {});
        if (lastUser.includes('PROBE_CORRUPT_TURN'))
          return { content: 'PROBE_REACHED_MODEL' };
      }
      if (serialized.includes(failoverFirstMarker)) {
        return bigOutput`,
);

// 2. Diagnostics for the first Turn (used by the base arm).
once(
  `      const firstTerminal = firstTurn.events.find((event) => event.terminal);`,
  `      const firstTerminal = firstTurn.events.find((event) => event.terminal);
      if (process.env['PROBE_DIAG'] === '1') {
        const deltaText = firstTurn.events
          .filter((event) => event.type === 'item.output_text.delta')
          .map(eventText)
          .join('');
        console.log(
          'PROBE_FIRST_TURN ' +
            JSON.stringify({
              terminal: firstTerminal,
              deltaChars: deltaText.length,
              deltaEqualsSource: deltaText === failoverFirstResponse,
              sourceChars: failoverFirstResponse.length,
              sourceUtf8Bytes: Buffer.byteLength(failoverFirstResponse),
              modelStreamRequests: fake?.requests.filter(({ body }) => body['stream'] === true).length,
              storedMessageKinds: runMysql(
                mysqlPort,
                \`SELECT GROUP_CONCAT(CONCAT(kind, ':', byte_length) ORDER BY kind SEPARATOR ',') FROM qwen_managed_agent.qwen_managed_session_resource WHERE tenant_id=\${sqlString(tenant)} AND session_id=\${sqlString(session.id)} AND kind LIKE 'managed-message%'\`,
              ),
            }),
        );
      }`,
);

// 3. Corrupt one chunk row before the cold replacement starts.
once(
  `    const replacementSpringPort = await freePort();`,
  `    const probeCorrupt = process.env['PROBE_CORRUPT'];
    let probeSaved: { id: string; kind: string; hex: string; row: string } | undefined;
    if (probeCorrupt) {
      const targetKind = probeCorrupt === 'manifest-missing' ? 'managed-message-chunks' : 'managed-message-part';
      const rows = runMysql(
        mysqlPort,
        \`SELECT resource_id, byte_length FROM qwen_managed_agent.qwen_managed_session_resource WHERE \${sessionFilter} AND kind='\${targetKind}' ORDER BY resource_id\`,
      ).split('\\n').filter(Boolean);
      if (rows.length === 0) throw new Error('PROBE: no row of kind ' + targetKind);
      const [id] = rows[0].split('\\t');
      const hex = runMysql(
        mysqlPort,
        \`SELECT HEX(inline_bytes) FROM qwen_managed_agent.qwen_managed_session_resource WHERE \${sessionFilter} AND resource_id=\${sqlString(id)}\`,
      );
      const row = runMysql(
        mysqlPort,
        \`SELECT kind, byte_length, sha256, LENGTH(inline_bytes) FROM qwen_managed_agent.qwen_managed_session_resource WHERE \${sessionFilter} AND resource_id=\${sqlString(id)}\`,
      );
      probeSaved = { id, kind: targetKind, hex, row };
      if (probeCorrupt === 'part-digest') {
        const bytes = Buffer.from(hex, 'hex');
        bytes[100] = bytes[100] ^ 0x01; // same length, ASCII stays ASCII
        runMysql(
          mysqlPort,
          \`UPDATE qwen_managed_agent.qwen_managed_session_resource SET inline_bytes=UNHEX('\${bytes.toString('hex')}') WHERE \${sessionFilter} AND resource_id=\${sqlString(id)}\`,
        );
      } else {
        writeFileSync(path.join(process.env['PROBE_OUT'] ?? '.', 'probe-deleted-row.tsv'),
          runMysql(mysqlPort, \`SELECT * FROM qwen_managed_agent.qwen_managed_session_resource WHERE \${sessionFilter} AND resource_id=\${sqlString(id)}\`));
        runMysql(
          mysqlPort,
          \`CREATE TABLE qwen_managed_agent.probe_saved AS SELECT * FROM qwen_managed_agent.qwen_managed_session_resource WHERE \${sessionFilter} AND resource_id=\${sqlString(id)}\`,
        );
        runMysql(
          mysqlPort,
          \`SET FOREIGN_KEY_CHECKS=0; DELETE FROM qwen_managed_agent.qwen_managed_session_resource WHERE \${sessionFilter} AND resource_id=\${sqlString(id)}\`,
        );
      }
      console.log('PROBE_CORRUPTED ' + JSON.stringify({ mode: probeCorrupt, id, row, partCount: rows.length,
        after: runMysql(mysqlPort, \`SELECT COUNT(*), IFNULL(MAX(SHA2(inline_bytes,256)),'-') FROM qwen_managed_agent.qwen_managed_session_resource WHERE \${sessionFilter} AND resource_id=\${sqlString(id)}\`) }));
    }
    const replacementSpringPort = await freePort();`,
);

// 4. Probe Turn against the cold replacement, then restore and continue.
once(
  `      const secondResponse = await fetch(
        \`\${replacementSpringUrl}/v1/agents/sessions/\${session.id}/events\`,`,
  `      if (probeCorrupt && probeSaved) {
        const modelBefore = fake?.requests.length ?? 0;
        const probeResponse = await fetch(
          \`\${replacementSpringUrl}/v1/agents/sessions/\${session.id}/events\`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'idempotency-key': \`probe-corrupt-\${Date.now()}\`,
              ...tenantHeaders(tenant),
            },
            body: JSON.stringify({
              type: 'agent.session.input.message',
              input: [{ type: 'text', text: 'PROBE_CORRUPT_TURN reply anything.' }],
            }),
          },
        );
        const probeStatus = probeResponse.status;
        const probeBody = await probeResponse.text();
        let probeTerminal: unknown = null;
        let probeEvents: unknown[] = [];
        if (probeStatus === 202) {
          try {
            const probeTurn = await waitForTerminal(
              replacementSpringUrl,
              tenant,
              session.id,
              firstTurnLastSequence,
              replacementSpring,
            );
            probeTerminal = probeTurn.events.find((event) => event.terminal) ?? null;
            probeEvents = probeTurn.events.map((event) => event.type);
            firstTurnLastSequence = probeTurn.lastSequence;
          } catch (error) {
            probeTerminal = { waitError: String(error) };
          }
        }
        const probeModelRequests = (fake?.requests ?? []).slice(modelBefore);
        console.log('PROBE_TURN ' + JSON.stringify({
          mode: probeCorrupt,
          postStatus: probeStatus,
          postBody: probeBody.slice(0, 600),
          terminal: probeTerminal,
          eventTypes: probeEvents,
          modelRequestsDuringProbe: probeModelRequests.length,
          modelSawFullFirstAnswer: probeModelRequests.some(({ body }) => JSON.stringify(body['messages']).includes(failoverFirstResponse)),
          sessionStatus: runMysql(mysqlPort, \`SELECT status FROM qwen_managed_agent.managed_agent_session WHERE \${sessionFilter}\`),
        }));
        for (const child of children.slice(-2)) {
          const lines = child.log().split('\\n').filter((line) => /409|recovery|digest|corrupt|hosted_|integrity|unavailable|ERROR|WARN/i.test(line));
          console.log('PROBE_LOG ' + child.name + ' ' + JSON.stringify(lines.slice(-30).map((line) => line.slice(0, 400))));
        }
        // Restore the exact stored bytes.
        if (probeCorrupt === 'part-digest') {
          runMysql(
            mysqlPort,
            \`UPDATE qwen_managed_agent.qwen_managed_session_resource SET inline_bytes=UNHEX('\${probeSaved.hex}') WHERE \${sessionFilter} AND resource_id=\${sqlString(probeSaved.id)}\`,
          );
        } else {
          runMysql(mysqlPort, \`SET FOREIGN_KEY_CHECKS=0; INSERT INTO qwen_managed_agent.qwen_managed_session_resource SELECT * FROM qwen_managed_agent.probe_saved; DROP TABLE qwen_managed_agent.probe_saved\`);
        }
        console.log('PROBE_RESTORED ' + JSON.stringify({ id: probeSaved.id,
          row: runMysql(mysqlPort, \`SELECT kind, byte_length, sha256, LENGTH(inline_bytes), SHA2(inline_bytes,256)=sha256 FROM qwen_managed_agent.qwen_managed_session_resource WHERE \${sessionFilter} AND resource_id=\${sqlString(probeSaved.id)}\`) }));
      }
      const secondResponse = await fetch(
        \`\${replacementSpringUrl}/v1/agents/sessions/\${session.id}/events\`,`,
);

// 5. The probe Turn adds one terminal event.
once(
  `        terminalCount !== 2
      ) {`,
  `        terminalCount !== (probeCorrupt && process.env['PROBE_EXPECT_PROBE_TERMINAL'] !== '0' ? 3 : 2)
      ) {`,
);

// 6. firstTurnLastSequence must be reassignable (it is a let in the PR runner).
if (!/let firstTurnLastSequence/.test(s)) throw new Error('firstTurnLastSequence is not a let');

writeFileSync(dst, s);
console.log('wrote', dst);
