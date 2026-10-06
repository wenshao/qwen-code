    } else if (sessionFailover) {
      const report = (label: string, started: number, result: { events: PublicEvent[]; lastSequence: number } | string) => {
        const terminal = typeof result === 'string' ? undefined : result.events.find((event) => event.terminal);
        console.log(JSON.stringify({
          probe: label,
          elapsedMs: Date.now() - started,
          terminal: typeof result === 'string' ? result : terminal?.type,
          text: typeof result === 'string' ? '' : result.events.filter((e) => e.type === 'item.output_text.delta').map((e) => eventText(e)).join(''),
          turns: runMysql(mysqlPort, `SELECT turn_id, status, IFNULL(error_code,'-'), submission_attempted, IF(harness_event_epoch IS NULL,'no-epoch','epoch') FROM qwen_managed_agent.managed_agent_turn WHERE ${sessionFilter} ORDER BY created_at`).split('\n'),
          harnessBootId: runMysql(mysqlPort, `SELECT harness_boot_id FROM qwen_managed_agent.managed_agent_session WHERE ${sessionFilter}`),
          journalTxForD4Prompt: runMysql(mysqlPort, `SELECT journal_revision, writer_generation, LEFT(writer_id, 8), LEFT(command_id, 80) FROM qwen_managed_agent.qwen_managed_session_journal_tx WHERE ${sessionFilter} AND command_id LIKE ${sqlString('%' + d4PromptId + '%')} ORDER BY journal_revision`).split('\n'),
          d4ModelRequests: (fake?.requests ?? []).filter(({ body }) => JSON.stringify(body['messages']).includes('PROBE_D4_TURN') && !JSON.stringify(body['messages']).includes('PROBE_LATER_TURN')).length,
          laterTurnContextHasD4: (() => { const reqs = (fake?.requests ?? []).filter(({ body }) => JSON.stringify(body['messages']).includes('PROBE_LATER_TURN')); const last = reqs[reqs.length - 1]; if (!last) return 'no turn-3 model request'; const m = JSON.stringify(last.body['messages']); return { prompt: m.includes('PROBE_D4_TURN'), answer: m.includes('D4_TURN_ANSWER') }; })(),
          terminalEvents: runMysql(mysqlPort, `SELECT COUNT(*) FROM qwen_managed_agent.managed_agent_event WHERE ${sessionFilter} AND terminal=TRUE`),
        }, null, 2));
      };
      const wait = async (after: number) => {
        try {
          return await waitForTerminal(replacementSpringUrl, tenant, session.id, after, replacementSpring, 120_000);
        } catch (error) {
          return `no terminal: ${String(error).slice(0, 160)}`;
        }
      };
      let started = Date.now();
      const d4 = await wait(firstTurnLastSequence);
      report('d4-turn-after-adoption', started, d4);
      started = Date.now();
      const r3 = await fetch(`${replacementSpringUrl}/v1/agents/sessions/${session.id}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': `probe-later-${Date.now()}`, ...tenantHeaders(tenant) },
        body: JSON.stringify({ type: 'agent.session.input.message', input: [{ type: 'text', text: 'PROBE_LATER_TURN turn3. Reply exactly LATER_TURN_OK.' }] }),
      });
      const t3 = await wait(typeof d4 === 'string' ? firstTurnLastSequence : d4.lastSequence);
      report(`turn3-submit-${r3.status}`, started, t3);
      console.log(`--- Spring log (filtered) ---\n${spring.log().split('\n').filter((l) => /Withdrew|terminal|will retry|declin|generation/i.test(l)).slice(-20).join('\n')}`);
      console.log(`--- proxy log (prompt/load) ---\n${dropProxy.log.filter((e) => /prompt|load|managed-runtime/.test(e.path)).map((e) => `${e.method} ${e.path.replace(/session\/[^/]+/, 'session/:id')} -> ${e.status}${e.held ? ' (held)' : ''}`).join('\n')}`);
    } else {
      const secondResponse = await fetch(
