        if (closeResponse.status === 409) {
          const active = runMysql(mysqlPort, `SELECT turn_id, status FROM qwen_managed_agent.managed_agent_turn WHERE ${sessionFilter} AND status IN ('ACCEPTED','RUNNING','CANCELLING') ORDER BY created_at`).split('\n').filter(Boolean);
          const escapeStarted = Date.now();
          const results: unknown[] = [];
          for (const row of active) {
            const [turnId] = row.split('\t');
            const c = await fetch(`${replacementSpringUrl}/v1/agents/sessions/${session.id}/events`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'idempotency-key': `probe-escape-cancel-${Date.now()}`, ...tenantHeaders(tenant) },
              body: JSON.stringify({ type: 'agent.session.cancel', turn_id: turnId }),
            });
            results.push({ turnId, cancelStatus: c.status });
          }
          let settled = false;
          for (let attempt = 0; attempt < 45 && !settled; attempt += 1) {
            settled = runMysql(mysqlPort, `SELECT COUNT(*) FROM qwen_managed_agent.managed_agent_turn WHERE ${sessionFilter} AND status IN ('ACCEPTED','RUNNING','CANCELLING')`) === '0';
            if (!settled) await new Promise((resolve) => setTimeout(resolve, 2_000));
          }
          const retryClose = await fetch(`${replacementSpringUrl}/v1/agents/sessions/${session.id}/close`, {
            method: 'POST',
            headers: { 'idempotency-key': `probe-close-retry-${Date.now()}`, ...tenantHeaders(tenant) },
          });
          console.log(JSON.stringify({
            probe: 'escape-attempt',
            activeBefore: active,
            cancels: results,
            activeTurnsSettledWithin90s: settled,
            turnsAfter: runMysql(mysqlPort, `SELECT turn_id, status, IFNULL(error_code,'-') FROM qwen_managed_agent.managed_agent_turn WHERE ${sessionFilter} ORDER BY created_at`).split('\n'),
            retryCloseStatus: retryClose.status,
            elapsedMs: Date.now() - escapeStarted,
          }, null, 2));
        }
        const createStarted = Date.now();
