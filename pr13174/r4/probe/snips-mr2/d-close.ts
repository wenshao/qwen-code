      {
        const started = Date.now();
        const closeResponse = await fetch(`${replacementSpringUrl}/v1/agents/sessions/${session.id}/close`, {
          method: 'POST',
          headers: { 'idempotency-key': `probe-close-${Date.now()}`, ...tenantHeaders(tenant) },
        });
        const closeBody = (await closeResponse.json().catch(() => ({}))) as { id?: string; status?: string };
        let operation: unknown = closeBody;
        if (closeBody.id) {
          try {
            await waitUntil('close operation', async () => {
              operation = await fetchJson(`${replacementSpringUrl}/v1/agents/sessions/${session.id}/operations/${closeBody.id}`, { headers: tenantHeaders(tenant) });
              const status = (operation as { status?: string }).status ?? '';
              return /succeeded|completed|failed|rejected/i.test(status);
            }, 60_000, replacementSpring);
          } catch (error) {
            operation = { waitError: String(error).slice(0, 160), last: operation };
          }
        }
        const sessionAfterClose = await fetchJson(`${replacementSpringUrl}/v1/agents/sessions/${session.id}`, { headers: tenantHeaders(tenant) }).catch((error) => ({ error: String(error).slice(0, 120) }));
        console.log(JSON.stringify({ probe: 'close-bricked-session', closeStatus: closeResponse.status, operation, sessionStatus: (sessionAfterClose as { status?: string }).status, elapsedMs: Date.now() - started }, null, 2));
        const createStarted = Date.now();
        const created = await fetch(`${replacementSpringUrl}/v1/agents/sessions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': `probe-new-session-${Date.now()}`, ...tenantHeaders(tenant) },
          body: JSON.stringify({ agent_id: 'qwen-code', input: [{ type: 'text', text: `${probeLaterMarker} new-session. Reply exactly LATER_TURN_OK.` }], metadata: { title: 'probe new session after brick' } }),
        });
        const newSession = (await created.json()) as { id: string };
        let newResult: { events: PublicEvent[]; lastSequence: number } | string;
        try {
          newResult = await waitForTerminal(replacementSpringUrl, tenant, newSession.id, 0, replacementSpring, 120_000);
        } catch (error) {
          newResult = `no terminal: ${String(error).slice(0, 160)}`;
        }
        const terminal = typeof newResult === 'string' ? newResult : newResult.events.find((event) => event.terminal)?.type;
        console.log(JSON.stringify({ probe: 'new-session-after-brick', createStatus: created.status, terminal, text: typeof newResult === 'string' ? '' : newResult.events.filter((e) => e.type === 'item.output_text.delta').map((e) => eventText(e)).join(''), elapsedMs: Date.now() - createStarted }, null, 2));
      }
      console.log(JSON.stringify({
        probe: 'model-requests',
