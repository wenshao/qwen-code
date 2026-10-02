      if (freeze) {
        // Wake the frozen Harness only after the replacement finished. The
        // replacement keeps committing its own activation renewals, so the
        // journal head legitimately moves; the fence is that nothing from
        // the former writer lands and the replacement's store refuses it.
        const replacementStorePort = Number(new URL(replacementSpringUrl).port);
        storeForwarder?.retarget(replacementStorePort);
        const wakeDbTime = runMysql(mysqlPort, 'SELECT NOW(6)');
        signalProcessTree(harness.child, 'SIGCONT');
        if (!processTreeExists(harness.child)) {
          throw new Error(
            'Frozen Harness did not survive the freeze: the fencing proof below would be vacuous',
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        const formerWriterTransactions = Number(
          runMysql(
            mysqlPort,
            `SELECT COUNT(*) FROM qwen_managed_agent.qwen_managed_session_journal_tx WHERE ${sessionFilter} AND writer_id = ${sqlString(firstBootId)} AND created_at >= ${sqlString(wakeDbTime)}`,
          ),
        );
        // Only the former Harness talks through the forwarder, so whatever
        // the replacement's store answered there came from the fenced writer.
        const formerStoreRequests =
          storeForwarder?.answeredBy(replacementStorePort) ?? [];
        const acceptedFormerRequests = formerStoreRequests.filter(
          (entry) => typeof entry.status === 'number' && entry.status < 300,
        );
        const bootAfterWake = runMysql(
          mysqlPort,
          `SELECT harness_boot_id FROM qwen_managed_agent.managed_agent_session WHERE ${sessionFilter}`,
        );
