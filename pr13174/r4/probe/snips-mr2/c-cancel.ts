      await crashChild(harness.child, `${hostedHarnessLabel} (original)`);
      if (process.env['PROBE_MR_CANCEL'] === '1') {
        const c = await fetch(`${springUrl}/v1/agents/sessions/${session.id}/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': `probe-mr-cancel-${Date.now()}`, ...tenantHeaders(tenant) },
          body: JSON.stringify({ type: 'agent.session.cancel', turn_id: probeTurn2Id }),
        });
        console.log(JSON.stringify({ probe: 'mr-cancel-submitted-while-harness-dead', status: c.status, body: (await c.text()).slice(0, 200) }));
      }
