    } else if (sessionFailover) {
      const submit = async (label: string) => {
        const r = await fetch(`${replacementSpringUrl}/v1/agents/sessions/${session.id}/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': `probe-${label}-${Date.now()}`, 'x-qwen-tenant-id': tenant },
          body: JSON.stringify({ type: 'agent.session.input.message', input: [{ type: 'text', text: `PROBE_LATER_TURN ${label}. Reply exactly LATER_TURN_OK.` }] }),
        });
        return { status: r.status, body: (await r.text()).slice(0, 300) };
      };
      const features = async () => {
        try {
          const r = await fetch(`http://127.0.0.1:${replacementHarnessPort}/capabilities`, { headers: { authorization: `Bearer ${harnessToken}` } });
          const j = (await r.json()) as { features?: string[] };
          return (j.features ?? []).filter((f) => /hosted_harness_private_v1|managed_session_journal_delta_v1/.test(f));
        } catch (error) {
          return [`capabilities failed: ${String(error)}`];
        }
      };
      const report = (label: string, started: number, result: { events: PublicEvent[]; lastSequence: number } | string, extra: Record<string, unknown> = {}) => {
        const terminal = typeof result === 'string' ? undefined : result.events.find((event) => event.terminal);
        const turns = runMysql(mysqlPort, `SELECT turn_id, status, IFNULL(error_code,'-'), IFNULL(LEFT(error_message,140),'-') FROM qwen_managed_agent.managed_agent_turn WHERE ${sessionFilter} ORDER BY created_at`).split('\n');
        console.log(JSON.stringify({
          probe: label,
          elapsedMs: Date.now() - started,
          terminal: typeof result === 'string' ? result : terminal?.type,
          lastTurn: turns[turns.length - 1],
          text: typeof result === 'string' ? '' : result.events.filter((e) => e.type === 'item.output_text.delta').map((e) => eventText(e)).join(''),
          harnessBootId: runMysql(mysqlPort, `SELECT harness_boot_id FROM qwen_managed_agent.managed_agent_session WHERE ${sessionFilter}`),
          journalHead: runMysql(mysqlPort, `SELECT writer_generation, journal_revision, committed_sequence FROM qwen_managed_agent.qwen_managed_session_journal_head WHERE ${sessionFilter}`),
          ...extra,
        }, null, 2));
      };
      const wait = async (after: number) => {
        try {
          return await waitForTerminal(replacementSpringUrl, tenant, session.id, after, replacementSpring, 90_000);
        } catch (error) {
          return `no terminal: ${String(error).slice(0, 160)}`;
        }
      };
      let after = firstTurnLastSequence;
      const rolledBackFeatures = await features();
      for (const label of ['turn2-on-rolled-back', 'turn3-on-rolled-back']) {
        const started = Date.now();
        const submitted = await submit(label);
        const result = await wait(after);
        report(label, started, result, { submitted: submitted.status, harnessFeatures: rolledBackFeatures, replacementCli: process.env['PROBE_REPLACEMENT_CLI'] ?? cliBundle });
        if (typeof result !== 'string') after = result.lastSequence;
      }
      await crashChild(replacementHarness.child, 'Rolled-back Hosted Harness');
      const thirdHome = path.join(temporary, 'third-harness-home');
      mkdirSync(path.join(thirdHome, '.qwen'), { recursive: true });
      writeFileSync(path.join(thirdHome, '.qwen', 'settings.json'), JSON.stringify({ ui: { enableFollowupSuggestions: false } }), { mode: 0o600 });
      const third = start(
        process.execPath,
        [cliBundle, 'serve', '--profile', 'hosted-harness', '--port', String(replacementHarnessPort), '--hostname', '127.0.0.1', '--require-auth', '--no-web', '--workspace', workspace],
        {
          env: {
            ...cleanEnvironment,
            HOME: thirdHome,
            LANG: process.env['LANG'] ?? 'C',
            LC_ALL: process.env['LC_ALL'] ?? 'C',
            QWEN_HOME: path.join(thirdHome, '.qwen'),
            QWEN_CODE_TRUSTED_FOLDERS_PATH: trustedFolders,
            QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST: capabilityDigest,
            QWEN_SERVER_TOKEN: harnessToken,
            OPENAI_API_KEY: 'fake-key',
            OPENAI_BASE_URL: fakeBaseUrl,
            OPENAI_MODEL: 'fake-model',
            QWEN_MODEL: 'fake-model',
            QWEN_RUNTIME_BROKER_TOKEN: brokerToken,
            QWEN_RUNTIME_BROKER_URL: replacementBrokerUrl,
          },
        },
        'Third (rolled-forward) Hosted Harness',
      );
      await waitUntil('Third Hosted Harness', async () => {
        const response = await fetch(`http://127.0.0.1:${replacementHarnessPort}/health?deep=1`, { headers: { authorization: `Bearer ${harnessToken}` } });
        return response.ok;
      }, 60_000, third);
      const forwardFeatures = await features();
      for (const label of ['turn4-after-roll-forward', 'turn5-after-roll-forward']) {
        const started = Date.now();
        const submitted = await submit(label);
        const result = await wait(after);
        report(label, started, result, { submitted: submitted.status, harnessFeatures: forwardFeatures });
        if (typeof result !== 'string') after = result.lastSequence;
      }
      console.log(`--- Spring log (filtered) ---\n${spring.log().split('\n').filter((l) => /terminal|declin|protocol|journal_delta|advertise|Managed Turn/i.test(l)).slice(-30).join('\n')}`);
    } else {
      const secondResponse = await fetch(
