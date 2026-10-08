package com.alibaba.qwen.code.managedagent.store;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Timeout;

/** Verification-only: runs the PR's collector suite against a real MySQL/MariaDB server. */
@Timeout(value = 240)
public class SessionResourceCollectionMySqlGate extends SessionResourceCollectionCollectorTest {
    protected O4MySqlDatabase database;

    @Override protected javax.sql.DataSource dataSource() {
        database = new O4MySqlDatabase();
        return database.source();
    }

    @AfterEach void dropDatabase() { if (database != null) { database.close(); } }
}
