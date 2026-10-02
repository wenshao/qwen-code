        const wokeAt = Date.now();
        const wakeDbNow = runMysql(mysqlPort, 'SELECT NOW(6)');
        if (process.env['PROBE_CONTROL_NO_WAKE'] !== '1') signalProcessTree(harness.child, 'SIGCONT');
