  } else if (secondWorkspaceSession) {
    // RIG (PR #13366 verification): N Workspace-bound Sessions on one mount,
    // created in RIG_ORDER with RIG_GAP_MS between creates. Records instead of
    // asserting: terminal shape per Session, the mount lease row over time,
    // Broker acquire traffic (tap), queue notices, tool rows and side effects.
    const rigOrder = (process.env['RIG_ORDER'] ?? 'A,B').split(',');
    const rigGapMs = Number(process.env['RIG_GAP_MS'] ?? '0');
    const rigWaitMs = Number(process.env['RIG_WAIT_MS'] ?? '180000');
    const rigCancel = process.env['RIG_CANCEL']; // "<label>@<ms after t0>"
    const rigFollowUps = (process.env['RIG_FOLLOWUP'] ?? '')
      .split(',')
      .filter(Boolean);
    const rigT0 = Date.now();
    rigLog('model.jsonl', { t: rigT0, t0: true });
    const rel = () => Date.now() - rigT0;
    const timeline: Array<Record<string, unknown>> = [];
    const mark = (what: string, extra: Record<string, unknown> = {}) => {
      const entry = { t: rel(), what, ...extra };
      timeline.push(entry);
      console.log(`[rig] ${JSON.stringify(entry)}`);
    };
    let sampling = true;
    let leasePrev = '';
    const leaseSampler = (async () => {
      while (sampling) {
        try {
          const row = await rigMysql(
            mysqlPort,
            "SELECT COALESCE(runtime_session_id, '-'), COALESCE(runtime_generation, '-') FROM qwen_managed_agent.managed_workspace_execution_lease",
          );
          if (row !== leasePrev) {
            leasePrev = row;
            mark('lease', { row: row.replaceAll('\t', ' ') });
          }
        } catch {
          // table not created until the first acquire
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    })();
    const marker = (label: string) => `MANAGED_SECOND_SESSION_${label}`;
    const done = (label: string) => `SECOND_SESSION_${label}_DONE`;
    const sessions = new Map<string, PublicSession>();
    const outcomes = new Map<
      string,
      { events: PublicEvent[]; lastSequence: number }
    >();
    const terminalAt = new Map<string, number>();
    const waits: Array<Promise<void>> = [];
    const watchByLabel = new Map<string, Promise<void>>();
    const watch = (label: string, sessionId: string, after: number) =>
      waitForTerminal(springUrl, tenant, sessionId, after, spring, rigWaitMs).then(
        (outcome) => {
          outcomes.set(label, outcome);
          terminalAt.set(label, rel());
          const terminal = outcome.events.find((event) => event.terminal);
          mark('terminal', {
            label,
            type: terminal?.type,
            data: JSON.stringify(terminal?.data ?? null).slice(0, 400),
          });
        },
        (cause: unknown) => {
          mark('no-terminal', { label, error: String(cause).slice(0, 200) });
        },
      );
    for (const [index, label] of rigOrder.entries()) {
      if (index > 0 && rigGapMs > 0)
        await new Promise((resolve) => setTimeout(resolve, rigGapMs));
      const session = await createManagedSession(
        springUrl,
        tenant,
        `rig-${label.toLowerCase()}`,
        `${marker(label)}. Execute the requested tool once, then reply exactly ${done(label)}.`,
        true,
      );
      sessions.set(label, session);
      mark('created', { label, session: session.id });
      const watching = watch(label, session.id, 0);
      watchByLabel.set(label, watching);
      waits.push(watching);
    }
    const turnsOf = async (label: string) =>
      fetchJson<PublicList<Record<string, unknown>>>(
        `${springUrl}/v1/agents/sessions/${sessions.get(label)!.id}/turns`,
        { headers: tenantHeaders(tenant) },
      );
    // RIG_PEEK="<label>@<ms>,…": what a public-API client sees for that Session
    // at that moment (Session, Turns, event types so far).
    const peeks = (process.env['RIG_PEEK'] ?? '')
      .split(',')
      .filter(Boolean)
      .map(async (spec) => {
        const [label, atText] = spec.split('@');
        while (rel() < Number(atText))
          await new Promise((resolve) => setTimeout(resolve, 50));
        const id = sessions.get(label!)!.id;
        const headers = { headers: tenantHeaders(tenant) };
        const session = await fetchJson<Record<string, unknown>>(
          `${springUrl}/v1/agents/sessions/${id}`,
          headers,
        );
        const turnList = await turnsOf(label!);
        const events = await fetchJson<PublicList<PublicEvent>>(
          `${springUrl}/v1/agents/sessions/${id}/events?after=0&limit=100`,
          headers,
        );
        mark('peek', {
          label,
          sessionStatus: session['status'],
          turns: turnList.data.map((turn) => turn['status']),
          events: events.data.map((event) => `${event.sequence}:${event.type}`),
        });
      });
    if (rigCancel) {
      const [label, atText] = rigCancel.split('@');
      const at = Number(atText);
      while (rel() < at) await new Promise((resolve) => setTimeout(resolve, 50));
      const turns = await turnsOf(label!);
      const running = turns.data.find((turn) => turn['status'] !== 'completed');
      const response = await fetch(
        `${springUrl}/v1/agents/sessions/${sessions.get(label!)!.id}/events`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': `rig-cancel-${Date.now()}`,
            ...tenantHeaders(tenant),
          },
          body: JSON.stringify({
            type: 'agent.session.cancel',
            turn_id: running?.['id'],
          }),
        },
      );
      mark('cancel', {
        label,
        turn: running?.['id'],
        turnStatus: running?.['status'],
        status: response.status,
        body: (await response.text()).slice(0, 200),
      });
    }
    // RIG_FOLLOWUP_EAGER=1 sends the follow-up as soon as that Session settles.
    const followUp = async (label: string) => {
      const session = sessions.get(label)!;
      const next = `${label}2`;
      const response = await fetch(
        `${springUrl}/v1/agents/sessions/${session.id}/events`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': `rig-followup-${next}-${Date.now()}`,
            ...tenantHeaders(tenant),
          },
          body: JSON.stringify({
            type: 'agent.session.input.message',
            input: [
              {
                type: 'text',
                text: `${marker(next)}. Execute the requested tool once, then reply exactly ${done(next)}.`,
              },
            ],
          }),
        },
      );
      mark('followup', { label: next, status: response.status });
      if (response.status === 202) {
        sessions.set(next, session);
        await watch(next, session.id, outcomes.get(label)?.lastSequence ?? 0);
      }
    };
    const eager = process.env['RIG_FOLLOWUP_EAGER'] === '1';
    const eagerRuns = eager
      ? rigFollowUps.map((label) => watchByLabel.get(label)!.then(() => followUp(label)))
      : [];
    await Promise.all(waits);
    await Promise.all(peeks);
    await Promise.all(eagerRuns);
    if (!eager) for (const label of rigFollowUps) await followUp(label);
    await new Promise((resolve) => setTimeout(resolve, 500));
    sampling = false;
    await leaseSampler;
    const labels = [...sessions.keys()];
    const texts = new Map(
      labels.map((label) => [
        label,
        (outcomes.get(label)?.events ?? [])
          .filter((event) => event.type === 'item.output_text.delta')
          .map(eventText)
          .join(''),
      ]),
    );
    const crossTalk = labels.some((label) =>
      labels.some(
        (other) =>
          other !== label &&
          !other.startsWith(label) &&
          !label.startsWith(other) &&
          texts.get(label)!.includes(done(other)),
      ),
    );
    const files = Object.fromEntries(
      labels.map((label) => {
        const file = path.join(
          workspaceMount,
          `managed-second-${label.toLowerCase()}.txt`,
        );
        return [
          label,
          existsSync(file) ? readFileSync(file, 'utf8').trim() : null,
        ];
      }),
    );
    const turns: Record<string, unknown> = {};
    for (const label of rigOrder)
      turns[label] = (await turnsOf(label)).data.map((turn) => ({
        status: turn['status'],
        error: turn['error'] ?? turn['last_error'] ?? undefined,
      }));
    const harnessLog = harness.log();
    const queueNotices = (
      harnessLog.match(/waits for the Workspace mount held by another Session/g) ??
      []
    ).length;
    const turnFailures = harnessLog
      .split('\n')
      .filter((line) => /Hosted Harness turn .* failed/.test(line))
      .map((line) => line.slice(0, 220));
    const executions = await rigMysql(
      mysqlPort,
      'SELECT execution_state, COUNT(*) FROM qwen_managed_agent.qwen_tool_execution GROUP BY execution_state',
    );
    const result = {
      arm: process.env['RIG_ARM'],
      scenario: process.env['RIG_SCENARIO'],
      order: rigOrder,
      terminals: Object.fromEntries(
        labels.map((label) => [
          label,
          {
            type: outcomes.get(label)?.events.find((event) => event.terminal)
              ?.type ?? null,
            atMs: terminalAt.get(label) ?? null,
            text: texts.get(label),
          },
        ]),
      ),
      turns,
      files,
      crossTalk,
      queueNotices,
      turnFailures,
      toolExecutions: executions.replaceAll('\t', ':').split('\n'),
      finalLease: leasePrev.replaceAll('\t', ' '),
      eventTypes: Object.fromEntries(
        labels.map((label) => [
          label,
          (outcomes.get(label)?.events ?? []).map((event) => event.type),
        ]),
      ),
      timeline,
    };
    rigLog('result.json', result);
    console.log(`RIG_RESULT ${JSON.stringify(result)}`);
