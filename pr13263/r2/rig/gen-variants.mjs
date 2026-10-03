// Generates runner variants beside the original in <worktree>/scripts.
// Every anchor must match the expected number of times or the generator
// aborts (fail closed), so a variant can never silently equal its parent.
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

const wt = '/Users/wenshao/git/pr13263-head';
const scripts = path.join(wt, 'scripts');
const BASE_SHA = '5130c1a734ec25134eb95444837949bb00c128dd';
const head = readFileSync(
  path.join(scripts, 'run-managed-agent-server-e2e.ts'),
  'utf8',
);
const base = execFileSync(
  'git',
  ['-C', wt, 'show', `${BASE_SHA}:scripts/run-managed-agent-server-e2e.ts`],
  { encoding: 'utf8' },
);

function count(text, needle) {
  return text.split(needle).length - 1;
}
function replace(text, from, to, expected = 1) {
  const n = count(text, from);
  if (n !== expected) {
    throw new Error(
      `anchor matched ${n} times (expected ${expected}):\n${from.slice(0, 200)}`,
    );
  }
  return text.split(from).join(to);
}

// Diagnostic-only: on failure in the real-model mode, dump the durable
// turn/event/execution rows (the runner only does this for failover modes).
const catchAnchor = '  failure = error;\n  console.error(error);\n';
const failDump = `${catchAnchor}  if (!durableFailover && dumpPort !== undefined) {
    try {
      console.error(
        \`OBS-FAIL turns:\\n\${runMysql(dumpPort, 'SELECT turn_id, status, error_code FROM qwen_managed_agent.managed_agent_turn')}\\nevents:\\n\${runMysql(dumpPort, 'SELECT sequence_id, event_type, terminal FROM qwen_managed_agent.managed_agent_event ORDER BY sequence_id')}\\nexecutions:\\n\${runMysql(dumpPort, 'SELECT tool_call_id, execution_state, execution_status, LEFT(reference_json, 300) FROM qwen_managed_agent.qwen_tool_execution')}\`,
      );
    } catch (dumpError) {
      console.error(\`OBS-FAIL dump failed: \${String(dumpError)}\`);
    }
    try {
      console.error('OBS-FAIL toolCalls:\\n' + runMysql(dumpPort, TOOLCALL_SQL));
    } catch (dumpError) {
      console.error(\`OBS-FAIL toolCalls failed: \${String(dumpError)}\`);
    }
  }
`;
// The SQL constant is declared in the generated script right after imports.
const TOOLCALL_DECL = `const TOOLCALL_SQL = ${JSON.stringify(
  "SELECT JSON_EXTRACT(CAST(CAST(inline_bytes AS CHAR CHARACTER SET utf8mb4) AS JSON), '$**.functionCall') FROM qwen_managed_agent.qwen_managed_session_resource WHERE kind='managed-message' AND CAST(inline_bytes AS CHAR CHARACTER SET utf8mb4) LIKE '%functionCall%'",
)};\n`;
const declAnchor = "const root = process.cwd();\n";
const withFailDump = (text) =>
  replace(replace(text, catchAnchor, failDump), declAnchor, TOOLCALL_DECL + declAnchor);

// Diagnostic-only: after every assertion of the real-model mode has passed,
// print visibility probes and the durable rows. Changes no assertion.
const summaryAnchor =
  '    console.log(\n      JSON.stringify(\n        {\n          model,\n';
const obsBlock = `    {
      const probe = async (label: string, headers: Record<string, string>) => {
        const response = await fetch(
          \`\${springUrl}/v1/agents/sessions/\${session.id}\`,
          { headers },
        );
        const text = await response.text();
        return {
          label,
          status: response.status,
          body: response.status === 200 ? '' : text.slice(0, 160),
        };
      };
      const probes = [
        await probe('sameTenant+actor', tenantHeaders(tenant)),
        await probe('sameTenant-noActor', { 'x-qwen-tenant-id': tenant }),
        await probe('otherTenant+actor', tenantHeaders('other-tenant')),
        await probe('otherTenant-noActor', {
          'x-qwen-tenant-id': 'other-tenant',
        }),
      ];
      console.log(
        'OBS ' +
          JSON.stringify({
            eventTypes: ordered.map(({ event }) => event.type),
            assistantText: ordered
              .map(({ event }) => eventText(event))
              .join('')
              .slice(0, 400),
            probes,
            executions: runMysql(
              mysqlPort,
              'SELECT tool_call_id, execution_state, execution_status, LEFT(reference_json, 300) FROM qwen_managed_agent.qwen_tool_execution',
            ),
            toolCalls: runMysql(mysqlPort, TOOLCALL_SQL),
            turns: runMysql(
              mysqlPort,
              'SELECT turn_id, status, error_code FROM qwen_managed_agent.managed_agent_turn',
            ),
            sideEffect,
            sideEffectContent: readFileSync(sideEffect, 'utf8'),
          }),
      );
    }
${summaryAnchor}`;

const variants = {};
variants['base'] = base;
variants['r1'] = execFileSync('git', ['-C', wt, 'show', '8e1375c380451456292a13c5f5bc2ddad6df134f:scripts/run-managed-agent-server-e2e.ts'], { encoding: 'utf8' });
variants['base-obs'] = withFailDump(base);
variants['obs'] = replace(withFailDump(head), summaryAnchor, obsBlock);

// M1 (defect 1): drop the Session Store wiring from the real-model Spring env.
variants['m1-no-session-store'] = withFailDump(
  replace(
    head,
    `              QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL: \`http://127.0.0.1:\${springPort}\`,
              QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED: 'true',
              QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION: '60s',
              QWEN_MANAGED_AGENT_WORKSPACE_ID: workspaceId,
              QWEN_MANAGED_AGENT_NODE_EXECUTABLE:`,
    `              QWEN_MANAGED_AGENT_NODE_EXECUTABLE:`,
  ),
);

// M2 (defect 2): drop the Broker CLI flags from the Harness (the two
// occurrences are the original and the replacement Harness).
variants['m2-no-broker-flags'] = withFailDump(
  replace(
    head,
    `      '--managed-runtime-broker-url',
      heldStartProxy?.baseUrl ?? \`http://127.0.0.1:\${brokerPort}\`,
      // Joined form: a base64url token can start with '-', which argv
      // would otherwise parse as another flag.
      \`--managed-runtime-broker-token=\${brokerToken}\`,
`,
    '',
  ),
);

// M3 (defect 3): no trusted-actor header on create/events/replay.
variants['m3-no-actor-header'] = withFailDump(
  replace(
    head,
    `    'x-qwen-tenant-id': tenant,
    [trustedActorHeader]: trustedActor,
  };`,
    `    'x-qwen-tenant-id': tenant,
  };`,
  ),
);

// M3b: actor header on create, but not on the event poll.
variants['m3b-poll-no-actor'] = withFailDump(
  replace(
    head,
    '          { headers: tenantHeaders(tenant) },\n        );\n        const now = Date.now();',
    "          { headers: { 'x-qwen-tenant-id': tenant } },\n        );\n        const now = Date.now();",
  ),
);

// M4 (defect 4a): ask for the absolute path again.
variants['m4-absolute-path'] = withFailDump(
  replace(
    head,
    `      'to the relative path',
      JSON.stringify(sideEffectName),
      'under the session working directory.',
`,
    `      'to this absolute path:',
      JSON.stringify(sideEffect),
`,
  ),
);

// M5 (defect 4b): require the public item.tool_call.updated event again.
variants['m5-require-tool-event'] = withFailDump(
  replace(
    head,
    `    const terminal = ordered.find(({ event }) => event.terminal);
    if (!firstModel || !runtimeReady || !terminal) {`,
    `    const tool = ordered.find(
      ({ event }) => event.type === 'item.tool_call.updated',
    );
    const terminal = ordered.find(({ event }) => event.terminal);
    if (!firstModel || !runtimeReady || !tool || !terminal) {`,
  ),
);

// A1: the audit must reject two physical executions.
variants['a1-write-twice'] = withFailDump(
  replace(
    replace(
      head,
      `      'Then call write_file exactly once to write the exact text',`,
      `      'Then call write_file two separate times (two tool calls, one after the other), each time writing the exact text',`,
    ),
    `      'Call no other tool before or after it.',\n`,
    '',
  ),
);

// A2: an exploratory directory listing before the write (bot finding 5).
variants['a2-list-first'] = withFailDump(
  replace(
    replace(
      head,
      `      'Then call write_file exactly once to write the exact text',`,
      `      'Then first call the directory listing tool once on the session working directory, and after that call write_file exactly once to write the exact text',`,
    ),
    `      'Call no other tool before or after it.',\n`,
    '',
  ),
);

// Diagnostic (obs-based) versions of the prompt mutants, plus M4b: the
// faithful revert of defect 4a (side effect back under the Harness workspace,
// absolute prompt path) on top of the other three fixes.
const obsText = variants['obs'];
const promptOnce = "      'Then call write_file exactly once to write the exact text',";
const noOther = "      'Call no other tool before or after it.',\n";
const relPath = "      'to the relative path',\n      JSON.stringify(sideEffectName),\n      'under the session working directory.',\n";
variants['a1obs'] = replace(replace(obsText, promptOnce, "      'Then call write_file two separate times (two tool calls, one after the other), each time writing the exact text',"), noOther, '');
variants['a2obs'] = replace(replace(obsText, promptOnce, "      'Then first call the directory listing tool once on the session working directory, and after that call write_file exactly once to write the exact text',"), noOther, '');
variants['m4obs'] = replace(obsText, relPath, "      'to this absolute path:',\n      JSON.stringify(sideEffect),\n");
variants['m4bobs'] = replace(replace(obsText, relPath, "      'to this absolute path:',\n      JSON.stringify(sideEffect),\n"), 'const sideEffect = path.join(workspaceMount, sideEffectName);', 'const sideEffect = path.join(workspace, sideEffectName);');
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
for (const [name, text] of Object.entries(variants)) {
  if (only && !only.includes(name)) continue;
  const file = path.join(scripts, `e2e-v-${name}.ts`);
  writeFileSync(file, text);
  console.log(
    `${name}: ${file} lines=${text.split('\n').length} differsFromHead=${text !== head}`,
  );
}
