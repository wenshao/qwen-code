        await new Promise((resolve) => setTimeout(resolve, 5_000));
        console.log(
          JSON.stringify(
            {
              probe: 'wake-observation',
              firstBootId,
              replacementBootId,
              txAfterWake: runMysql(
                mysqlPort,
                `SELECT journal_revision, writer_generation, LEFT(writer_id, 8), LEFT(command_id, 60), created_at FROM qwen_managed_agent.qwen_managed_session_journal_tx WHERE ${sessionFilter} AND journal_revision > ${Number(headBeforeWake.split('\t')[1])} ORDER BY journal_revision`,
              ).split('\n'),
              head: runMysql(
                mysqlPort,
                `SELECT writer_generation, LEFT(writer_id, 8), journal_revision, committed_sequence, writer_lease_until FROM qwen_managed_agent.qwen_managed_session_journal_head WHERE ${sessionFilter}`,
              ),
            },
            null,
            2,
          ),
        );
        console.log(
          `--- Harness A log after wake ---\n${harness.log().split('\n').filter((line) => /stall|stale|writer|store|fenc|blocked|failed|renew/i.test(line)).slice(-12).join('\n')}`,
        );
        const headAfterWake = runMysql(
