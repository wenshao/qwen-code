    if (inflightFailover) {
      if (process.env['PROBE_WS_SECOND'] === '1') {
        const first = await waitForTerminal(springUrl, tenant, session.id, 0, spring, 120_000);
        wsAfterSequence = first.lastSequence;
        console.log(JSON.stringify({ probe: 'ws-turn1', terminal: first.events.find((event) => event.terminal)?.type, executions: runMysql(mysqlPort, 'SELECT COUNT(*) FROM qwen_managed_agent.qwen_tool_execution') }));
        const t2 = await fetch(`${springUrl}/v1/agents/sessions/${session.id}/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': `probe-ws-turn2-${Date.now()}`, ...tenantHeaders(tenant) },
          body: JSON.stringify({ type: 'agent.session.input.message', input: [{ type: 'text', text: 'PROBE_WS_TURN2 second Turn, held mid model round.' }] }),
        });
        console.log(JSON.stringify({ probe: 'ws-turn2-submit', status: t2.status, body: (await t2.text()).slice(0, 160) }));
        await waitUntil('Workspace Turn 2 model round reached the model', () => (fake?.requests ?? []).some(({ body }) => JSON.stringify(body['messages']).includes('PROBE_WS_TURN2')), 120_000, harness);
      } else {
        await waitUntil('Workspace model round reached the model', () => (fake?.requests ?? []).some(({ body }) => JSON.stringify(body['messages']).includes(inflightMarker)), 120_000, harness);
      }
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      console.log(JSON.stringify({ probe: 'ws-before-crash', turns: runMysql(mysqlPort, `SELECT turn_id, status, IFNULL(error_code,'-'), submission_attempted, IF(harness_event_epoch IS NULL,'no-epoch','epoch') FROM qwen_managed_agent.managed_agent_turn WHERE tenant_id=${sqlString(tenant)} AND session_id=${sqlString(session.id)} ORDER BY created_at`).split('\n'), executions: runMysql(mysqlPort, 'SELECT COUNT(*) FROM qwen_managed_agent.qwen_tool_execution') }));
    } else if (continuationFailover) {
