    let d4PromptId = '';
    {
      dropProxy.arm();
      const r = await fetch(`${springUrl}/v1/agents/sessions/${session.id}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': `probe-d4-${Date.now()}`, ...tenantHeaders(tenant) },
        body: JSON.stringify({ type: 'agent.session.input.message', input: [{ type: 'text', text: 'PROBE_D4_TURN. Reply with anything.' }] }),
      });
      if (r.status !== 202) throw new Error(`probe D4 submit returned ${r.status}: ${await r.text()}`);
      const accepted = (await r.json()) as { turn_id: string };
      await waitUntil('D4 prompt reply dropped', () => dropProxy.dropped() !== undefined, 60_000, harness);
      await waitUntil('D4 model round reached the model', () => (fake?.requests ?? []).some(({ body }) => JSON.stringify(body['messages']).includes('PROBE_D4_TURN')), 30_000, harness);
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      if (process.env['PROBE_D4_CANCEL'] === '1') {
        const c = await fetch(`${springUrl}/v1/agents/sessions/${session.id}/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': `probe-d4-cancel-${Date.now()}`, ...tenantHeaders(tenant) },
          body: JSON.stringify({ type: 'agent.session.cancel', turn_id: accepted.turn_id }),
        });
        console.log(JSON.stringify({ probe: 'd4-cancel-submitted', status: c.status, body: (await c.text()).slice(0, 200) }));
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      d4PromptId = runMysql(mysqlPort, `SELECT prompt_id FROM qwen_managed_agent.managed_agent_turn WHERE turn_id = ${sqlString(accepted.turn_id)}`);
      console.log(JSON.stringify({
        probe: 'd4-before-crash',
        dropped: dropProxy.dropped(),
        d4TurnId: accepted.turn_id,
        d4PromptId,
        turns: runMysql(mysqlPort, `SELECT turn_id, status, IFNULL(error_code,'-'), submission_attempted, IF(harness_event_epoch IS NULL,'no-epoch','epoch') FROM qwen_managed_agent.managed_agent_turn WHERE ${sessionFilter} ORDER BY created_at`).split('\n'),
        journalTxForPrompt: runMysql(mysqlPort, `SELECT journal_revision, writer_generation, LEFT(command_id, 80) FROM qwen_managed_agent.qwen_managed_session_journal_tx WHERE ${sessionFilter} AND command_id LIKE ${sqlString('%' + d4PromptId + '%')} ORDER BY journal_revision`).split('\n'),
        proxyHeldSoFar: dropProxy.log.filter((e) => e.held).length,
      }, null, 2));
    }
    if (freeze) {
      // Freeze the writer side only
