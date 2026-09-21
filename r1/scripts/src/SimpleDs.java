package com.alibaba.qwen.code.runtimebroker;

import java.io.PrintWriter;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.SQLFeatureNotSupportedException;
import java.util.logging.Logger;
import javax.sql.DataSource;

/** Minimal DriverManager-backed DataSource for the verification harness. */
public final class SimpleDs implements DataSource {
    private final String url;
    private final String user;
    private final String password;

    public SimpleDs(String url, String user, String password) {
        this.url = url;
        this.user = user;
        this.password = password;
    }

    public static SimpleDs of(String url) {
        if (url.startsWith("jdbc:h2:")) {
            return new SimpleDs(url, "sa", "");
        }
        return new SimpleDs(url, "root", "");
    }

    @Override
    public Connection getConnection() throws SQLException {
        return DriverManager.getConnection(url, user, password);
    }

    @Override
    public Connection getConnection(String u, String p) throws SQLException {
        return DriverManager.getConnection(url, u, p);
    }

    @Override
    public PrintWriter getLogWriter() {
        return null;
    }

    @Override
    public void setLogWriter(PrintWriter out) {
    }

    @Override
    public void setLoginTimeout(int seconds) {
    }

    @Override
    public int getLoginTimeout() {
        return 0;
    }

    @Override
    public Logger getParentLogger() throws SQLFeatureNotSupportedException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public <T> T unwrap(Class<T> iface) throws SQLException {
        throw new SQLException("not a wrapper");
    }

    @Override
    public boolean isWrapperFor(Class<?> iface) {
        return false;
    }
}
