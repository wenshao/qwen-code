    if (inflightFailover) {
      const step = process.env['PROBE_APPROVAL_STEP'] ?? 'allow';
      const action = probeApprovalAction ?? {};
      const actionId = String(action['id'] ?? action['action_id'] ?? '');
      let stepResult: Record<string, unknown> = {};
      if (step === 'allow' || step === 'allow-cancel') {
        const options = (action['options'] ?? []) as Record<string, unknown>[];
        const optionId = (o: Record<string, unknown>) => String(o['option_id'] ?? o['optionId'] ?? o['id'] ?? '');
        const chosen = options.find((o) => /allow|proceed/i.test(`${optionId(o)} ${String(o['kind'] ?? '')}`) && !/always/i.test(`${optionId(o)} ${String(o['kind'] ?? '')}`)) ?? options[0] ?? {};
        const r = await fetch(`${replacementSpringUrl}/v1/agents/sessions/${session.id}/actions/${actionId}/responses`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': `probe-ap-allow-${Date.now()}`, ...tenantHeaders(tenant) },
          body: JSON.stringify({ kind: action['kind'], input_revision: action['input_revision'] ?? action['inputRevision'] ?? 1, policy_revision: action['policy_revision'] ?? action['policyRevision'], option_id: optionId(chosen) }),
        });
        stepResult = { step, optionId: optionId(chosen), status: r.status, body: (await r.text()).slice(0, 240) };
        if (step === 'allow-cancel') {
          await new Promise((resolve) => setTimeout(resolve, 15_000));
          const turnId = runMysql(mysqlPort, `SELECT turn_id FROM qwen_managed_agent.managed_agent_turn WHERE tenant_id=${sqlString(tenant)} AND session_id=${sqlString(session.id)} ORDER BY created_at DESC LIMIT 1`);
          const actionMid = await fetchJson(`${replacementSpringUrl}/v1/agents/sessions/${session.id}/actions/${actionId}`, { headers: tenantHeaders(tenant) }).catch(() => ({}));
          const c = await fetch(`${replacementSpringUrl}/v1/agents/sessions/${session.id}/events`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'idempotency-key': `probe-ap-allow-cancel-${Date.now()}`, ...tenantHeaders(tenant) },
            body: JSON.stringify({ type: 'agent.session.cancel', turn_id: turnId }),
          });
          stepResult = { ...stepResult, actionBeforeCancel: (actionMid as Record<string, unknown>)['state'], cancelStatus: c.status, cancelBody: (await c.text()).slice(0, 160) };
        }
      } else if (step === 'cancel') {
        const turnId = runMysql(mysqlPort, `SELECT turn_id FROM qwen_managed_agent.managed_agent_turn WHERE tenant_id=${sqlString(tenant)} AND session_id=${sqlString(session.id)} ORDER BY created_at DESC LIMIT 1`);
        const r = await fetch(`${replacementSpringUrl}/v1/agents/sessions/${session.id}/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': `probe-ap-cancel-${Date.now()}`, ...tenantHeaders(tenant) },
          body: JSON.stringify({ type: 'agent.session.cancel', turn_id: turnId }),
        });
        stepResult = { step, status: r.status, body: (await r.text()).slice(0, 200) };
      }
      console.log(JSON.stringify({ probe: 'ap-step-after-takeover', ...stepResult }));
      let result: { events: PublicEvent[]; lastSequence: number } | string;
      const started = Date.now();
      try {
        result = await waitForTerminal(replacementSpringUrl, tenant, session.id, 0, replacementSpring, 120_000);
      } catch (error) {
        result = `no terminal: ${String(error).slice(0, 120)}`;
      }
      const terminal = typeof result === 'string' ? result : result.events.find((event) => event.terminal)?.type;
      const actionAfter = await fetchJson(`${replacementSpringUrl}/v1/agents/sessions/${session.id}/actions/${actionId}`, { headers: tenantHeaders(tenant) }).catch((error) => ({ error: String(error).slice(0, 120) }));
      const turns = runMysql(mysqlPort, `SELECT turn_id, status, IFNULL(error_code,'-'), IFNULL(LEFT(error_message,140),'-') FROM qwen_managed_agent.managed_agent_turn WHERE tenant_id=${sqlString(tenant)} AND session_id=${sqlString(session.id)}`).split('\n');
      let ops: string[] = [];
      try {
        ops = runMysql(mysqlPort, `SELECT operation_kind, state, delivery_state, attempt_count FROM qwen_managed_agent.managed_agent_operation WHERE session_id=${sqlString(session.id)}`).split('\n');
      } catch (error) {
        ops = [`query failed: ${String(error).slice(0, 100)}`];
      }
      const next = await fetch(`${replacementSpringUrl}/v1/agents/sessions/${session.id}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': `probe-ap-next-${Date.now()}`, ...tenantHeaders(tenant) },
        body: JSON.stringify({ type: 'agent.session.input.message', input: [{ type: 'text', text: 'probe next Turn after approval takeover' }] }),
      });
      const nextBody = (await next.text()).slice(0, 200);
      const closeResponse = await fetch(`${replacementSpringUrl}/v1/agents/sessions/${session.id}/close`, {
        method: 'POST',
        headers: { 'idempotency-key': `probe-ap-close-${Date.now()}`, ...tenantHeaders(tenant) },
      });
      const closeBody = (await closeResponse.text()).slice(0, 200);
      console.log(JSON.stringify({
        probe: 'ap-after-restart',
        step,
        elapsedMs: Date.now() - started,
        terminal,
        actionState: (actionAfter as Record<string, unknown>)['state'] ?? (actionAfter as Record<string, unknown>)['status'] ?? actionAfter,
        turns,
        ops,
        nextStatus: next.status,
        nextBody,
        closeStatus: closeResponse.status,
        closeBody,
        sideEffectWritten: existsSync(inflightSideEffect),
        modelRequests: (fake?.requests ?? []).filter(({ body }) => JSON.stringify(body['messages']).includes(inflightMarker)).length,
      }, null, 2));
      console.log(`--- Spring coordinator ---\n${replacementSpring.log().split('\n').filter((l) => /WARN|ERROR|etry|epoch|409|Withdr|recover|Recover|attach|Attach|approval|Approval/.test(l) && !/DEBUG/.test(l)).map((l) => l.replace(/^\S+\s+\S+\s+/, '').slice(0, 260)).slice(-14).join('\n')}`);
      console.log(`--- replacement Harness routes ---\n${replacementHarness.log().split('\n').filter((l) => /route=(POST|GET) \/session\/|load refused|recovery|declin|settle|approval|permission/i.test(l)).map((l) => l.replace(/^.*route=/, 'route=').replace(/ sessionId=\S+| clientId=\S+/g, '').slice(0, 170)).slice(-16).join('\n')}`);
    } else if (continuationFailover) {
