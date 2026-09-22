package com.alibaba.qwen.code.runtimebroker;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.sql.DataSource;

/** Shared helpers for the PR #12445 round-2 probes (lives in the module package). */
final class HarnessSupport {
    private HarnessSupport() {
    }

    static DataSource dataSource(String url, String user, String password) {
        return new SimpleDataSource(url, user, password);
    }

    static DataSource h2(String name) {
        return dataSource("jdbc:h2:mem:" + name
                + ";MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE", "sa", "");
    }

    static void install(DataSource ds) {
        JdbcRuntimeBrokerSchema.initialize(ds);
    }

    static Map<String, Object> reference(String p) {
        Map<String, Object> ref = new LinkedHashMap<>();
        ref.put("sessionId", p + "-rs");
        ref.put("promptId", p + "-turn");
        ref.put("callId", p + "-tool");
        ref.put("argsDigest", p + "-digest");
        return ref;
    }

    static ToolExecutionRecord candidate(String p, Map<String, Object> ref) {
        return ToolExecutionRecord.prepared(p + "-exec", p + "-key", p + "-binding", 1,
                p + "-harness", p + "-rs", p + "-turn", p + "-tool", p + "-digest", ref);
    }

    static void exec(DataSource ds, String sql) {
        try (Connection c = ds.getConnection(); PreparedStatement s = c.prepareStatement(sql)) {
            s.execute();
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    static final class SimpleDataSource implements DataSource {
        private final String url;
        private final String user;
        private final String password;

        SimpleDataSource(String url, String user, String password) {
            this.url = url;
            this.user = user;
            this.password = password;
        }

        @Override public Connection getConnection() throws SQLException {
            return DriverManager.getConnection(url, user, password);
        }
        @Override public Connection getConnection(String u, String p) throws SQLException {
            return DriverManager.getConnection(url, u, p);
        }
        @Override public java.io.PrintWriter getLogWriter() { return null; }
        @Override public void setLogWriter(java.io.PrintWriter out) { }
        @Override public void setLoginTimeout(int seconds) { }
        @Override public int getLoginTimeout() { return 0; }
        @Override public java.util.logging.Logger getParentLogger() { return null; }
        @Override public <T> T unwrap(Class<T> iface) { return null; }
        @Override public boolean isWrapperFor(Class<?> iface) { return false; }
    }
}
