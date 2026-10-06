    acceptReplacementContinuation = true;
    releaseContinuationHold();
    if (inflightFailover && process.env['PROBE_WS_CANCEL'] === '1') {
      const turnId = runMysql(mysqlPort, `SELECT turn_id FROM qwen_managed_agent.managed_agent_turn WHERE tenant_id=${sqlString(tenant)} AND session_id=${sqlString(session.id)} ORDER BY created_at DESC LIMIT 1`);
      const c = await fetch(`${springUrl}/v1/agents/sessions/${session.id}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': `probe-ws-cancel-${Date.now()}`, ...tenantHeaders(tenant) },
        body: JSON.stringify({ type: 'agent.session.cancel', turn_id: turnId }),
      });
      console.log(JSON.stringify({ probe: 'ws-cancel-while-harness-dead', status: c.status, body: (await c.text()).slice(0, 160) }));
    }
    wsHoldReleased = true;
    releaseWsHold();
