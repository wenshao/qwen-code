    if (inflightFailover) {
      let result: { events: PublicEvent[]; lastSequence: number } | string;
      const started = Date.now();
      try {
        result = await waitForTerminal(replacementSpringUrl, tenant, session.id, wsAfterSequence, replacementSpring, 120_000);
      } catch (error) {
        result = `no terminal: ${String(error).slice(0, 120)}`;
      }
      const terminal = typeof result === 'string' ? result : result.events.find((event) => event.terminal)?.type;
      const turns = runMysql(mysqlPort, `SELECT turn_id, status, IFNULL(error_code,'-'), IFNULL(LEFT(error_message,140),'-') FROM qwen_managed_agent.managed_agent_turn WHERE tenant_id=${sqlString(tenant)} AND session_id=${sqlString(session.id)}`).split('\n');
      if (process.env['PROBE_WS_NEXT'] === '1') {
        const before = typeof result === 'string' ? 0 : result.lastSequence;
        const n = await fetch(`${replacementSpringUrl}/v1/agents/sessions/${session.id}/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': `probe-ws-next-${Date.now()}`, ...tenantHeaders(tenant) },
          body: JSON.stringify({ type: 'agent.session.input.message', input: [{ type: 'text', text: 'probe next Turn after the workspace cancel' }] }),
        });
        const nBody = (await n.text()).slice(0, 200);
        let nTerminal: string | undefined;
        if (n.status === 202) {
          try {
            const r2 = await waitForTerminal(replacementSpringUrl, tenant, session.id, before, replacementSpring, 90_000);
            nTerminal = r2.events.find((event) => event.terminal)?.type;
          } catch (error) {
            nTerminal = `no terminal: ${String(error).slice(0, 100)}`;
          }
        }
        console.log(JSON.stringify({ probe: 'ws-next-turn', status: n.status, body: nBody, terminal: nTerminal }));
      }
      const closeResponse = await fetch(`${replacementSpringUrl}/v1/agents/sessions/${session.id}/close`, {
        method: 'POST',
        headers: { 'idempotency-key': `probe-ws-close-${Date.now()}`, ...tenantHeaders(tenant) },
      });
      const closeBody = (await closeResponse.text()).slice(0, 200);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      const sessionAfter = await fetchJson(`${replacementSpringUrl}/v1/agents/sessions/${session.id}`, { headers: tenantHeaders(tenant) }).catch((error) => ({ error: String(error).slice(0, 120) }));
      console.log(JSON.stringify({
        probe: 'ws-after-restart',
        cancelVariant: process.env['PROBE_WS_CANCEL'] === '1',
        elapsedMs: Date.now() - started,
        terminal,
        turns,
        closeStatus: closeResponse.status,
        closeBody,
        sessionStatus: (sessionAfter as { status?: string }).status,
        modelRequests: (fake?.requests ?? []).filter(({ body }) => JSON.stringify(body['messages']).includes(inflightMarker)).length,
      }, null, 2));
      console.log(`--- replacement Harness routes ---\n${replacementHarness.log().split('\n').filter((l) => /route=POST \/session\/[^ ]*\/(load|cancel|prompt)|load refused|recovery|declin|settle/.test(l)).map((l) => l.replace(/^.*route=/, 'route=').replace(/ sessionId=\S+| clientId=\S+/g, '').slice(0, 170)).slice(-14).join('\n')}`);
    } else if (continuationFailover) {
