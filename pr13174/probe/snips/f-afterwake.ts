        await new Promise((resolve) => setTimeout(resolve, probeWakeMs));
        const wokenStoreCalls = storeProxyLog.filter((entry) => entry.at >= wokeAt);
        const beforeRevision = Number(headBeforeWake.split('\t')[1]);
        console.log(JSON.stringify({
          probe: 'after-wake',
          wakeWindowMs: probeWakeMs,
          controlNoWake: process.env['PROBE_CONTROL_NO_WAKE'] === '1',
          harnessAAlive: processTreeExists(harness.child),
          storeProxy: Boolean(storeProxy),
          wokenStoreCalls: wokenStoreCalls.map((e) => `${e.method} ${e.path.replace(/\?.*$/, '').replace(/sessions\/[^/]+/, 'sessions/:id')} -> ${e.status} (target :${e.target})`),
          storeCallsTotal: storeProxyLog.length,
          wakeDbNow,
          headBeforeWake,
          firstBootId,
          replacementBootId,
          txAfterBeforeWakeRevision: runMysql(mysqlPort, `SELECT journal_revision, writer_generation, writer_id, LEFT(command_id, 100), created_at FROM qwen_managed_agent.qwen_managed_session_journal_tx WHERE ${sessionFilter} AND journal_revision > ${beforeRevision} ORDER BY journal_revision`).split('\n'),
          txAll: runMysql(mysqlPort, `SELECT journal_revision, writer_generation, LEFT(writer_id, 8), LEFT(command_id, 70), created_at FROM qwen_managed_agent.qwen_managed_session_journal_tx WHERE ${sessionFilter} ORDER BY journal_revision`).split('\n'),
        }, null, 2));
        console.log(`--- Harness A log tail after wake ---\n${harness.log().slice(-5000)}`);
        const formerWriterTxAfterWake = Number(runMysql(mysqlPort, `SELECT COUNT(*) FROM qwen_managed_agent.qwen_managed_session_journal_tx WHERE ${sessionFilter} AND writer_id = ${sqlString(firstBootId)} AND created_at >= ${sqlString(wakeDbNow)}`));
        const formerLeaseRenewedAfterWake = storeProxyLog.filter((entry) => entry.at >= wokeAt && entry.status === 200).length;
        console.log(JSON.stringify({ probe: 'fence-summary', formerWriterTxAfterWake, formerStoreCalls200AfterWake: formerLeaseRenewedAfterWake, fixedAssert: process.env['PROBE_FIXED_ASSERT'] === '1' }));
        const headAfterWake
