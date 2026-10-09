package com.alibaba.qwen.code.runtimebroker;

import java.io.PrintWriter;
import java.lang.reflect.Field;
import java.net.InetSocketAddress;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.SQLFeatureNotSupportedException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;
import javax.sql.DataSource;

/**
 * PR 13297 real-stack rig. Two modes:
 *
 * broker  &lt;port&gt; &lt;token&gt; &lt;jdbcUrl&gt; &lt;bundle&gt; &lt;cwd&gt; — Runtime Broker HTTP face on
 *         JDBC repositories (MySQL through the fault proxy) with real
 *         `node dist/cli.js managed-runtime-worker` processes.
 * observe &lt;bundle&gt; &lt;cwd&gt; — R2-3: kill -9 a real worker, observe twice, report
 *         the ownership map and the issued tombstones by reflection.
 */
public final class Pr13297Rig {
    private static final String DIGEST = "sha256:" + "a".repeat(64);

    public static void main(String[] args) throws Exception {
        if ("broker".equals(args[0])) {
            broker(Integer.parseInt(args[1]), args[2], args[3], args[4], args[5]);
        } else if ("observe".equals(args[0])) {
            observe(args[1], args[2]);
        } else {
            throw new IllegalArgumentException(args[0]);
        }
    }

    private static void broker(int port, String token, String jdbcUrl,
            String bundle, String cwd) throws Exception {
        DataSource source = new SimpleDataSource(jdbcUrl, "rig", "rig");
        JdbcRuntimeBrokerSchema.initialize(source);
        RuntimeScope scope = new RuntimeScope("tenant-rig", "workspace-rig",
                "1", cwd, DIGEST, "workspace");
        HttpRuntimeTransport transport = new HttpRuntimeTransport();
        LocalProcessRuntimeProvisioner provisioner = new LocalProcessRuntimeProvisioner(
                List.of("node", bundle, "managed-runtime-worker"),
                Path.of(cwd), transport);
        RuntimeBrokerService service = new RuntimeBrokerService(
                ignored -> CompletableFuture.completedFuture(scope),
                provisioner, transport,
                new JdbcRuntimeBindingRepository(source,
                        new AesGcmSecretProtector("rig", new byte[32])),
                new JdbcRuntimeSessionRepository(source),
                new JdbcToolExecutionRepository(source),
                "broker-rig-" + ProcessHandle.current().pid(),
                Duration.ofSeconds(30), Duration.ofSeconds(30));
        RuntimeBrokerHttpServer server = new RuntimeBrokerHttpServer(
                new InetSocketAddress("127.0.0.1", port), token, service);
        server.start();
        System.out.println("RIG_READY port=" + port + " pid="
                + ProcessHandle.current().pid());
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            try {
                server.close();
                service.close();
                provisioner.close();
            } catch (Exception ignored) {
                // best effort
            }
        }));
        Thread.currentThread().join();
    }

    private static void observe(String bundle, String cwd) throws Exception {
        RuntimeScope scope = new RuntimeScope("tenant-a", "workspace-a", "7",
                cwd, DIGEST, "workspace");
        RuntimeProvisionRequest request = new RuntimeProvisionRequest(scope,
                null, LocalProcessRuntimeProvisioner.KIND);
        RuntimeProvisionSeed seed = RuntimeProvisionSeed.create("binding-1", 1);
        try (LocalProcessRuntimeProvisioner provisioner = new LocalProcessRuntimeProvisioner(
                List.of("node", bundle, "managed-runtime-worker"),
                Path.of(cwd), new HttpRuntimeTransport())) {
            RuntimeResourceHandle handle = provisioner
                    .ensureResource(request, seed, null)
                    .toCompletableFuture().get(10, TimeUnit.SECONDS);
            RuntimeLease lease = provisioner.provision(request, seed)
                    .toCompletableFuture().get(60, TimeUnit.SECONDS);
            ProcessHandle worker = ProcessHandle.current().children()
                    .findFirst().orElseThrow();
            print("worker", "pid=" + worker.pid() + " cmd="
                    + worker.info().commandLine().orElse("?").replaceAll(" .*/dist/", " .../dist/"));
            print("owned_before_kill", size(provisioner, "owned"));
            print("issued_entries", describe(provisioner, "issued", lease.getToken()));
            print("observe_alive", provisioner.reconcile(request, seed, handle, lease)
                    .toCompletableFuture().get(10, TimeUnit.SECONDS).getOutcome());
            Process kill = new ProcessBuilder("kill", "-9", Long.toString(worker.pid()))
                    .inheritIO().start();
            kill.waitFor();
            worker.onExit().get(10, TimeUnit.SECONDS);
            print("killed", "kill -9 " + worker.pid() + " exit=" + kill.exitValue());
            for (int i = 1; i <= 3; i++) {
                RuntimeObservation observed = provisioner
                        .reconcile(request, seed, handle, lease)
                        .toCompletableFuture().get(10, TimeUnit.SECONDS);
                print("observe_dead_" + i, observed.getOutcome()
                        + (observed.getLossEvidence() == null ? ""
                                : " evidence=" + observed.getLossEvidence().source()
                                        + "@" + observed.getLossEvidence().hostDomain()
                                                .replaceAll("^.*:", "pid:")));
                print("owned_after_observe_" + i, size(provisioner, "owned"));
            }
            print("owned_entry_holds_token", containsToken(provisioner, "owned", lease.getToken()));
            print("issued_holds_token", containsToken(provisioner, "issued", lease.getToken()));
            print("reaped", size(provisioner, "reaped"));
        }
    }

    private static Object field(Object target, String name) {
        try {
            Field field = target.getClass().getDeclaredField(name);
            field.setAccessible(true);
            return field.get(target);
        } catch (NoSuchFieldException error) {
            return null;
        } catch (IllegalAccessException error) {
            throw new IllegalStateException(error);
        }
    }

    private static String size(Object target, String name) {
        Object value = field(target, name);
        if (value == null) {
            return "absent";
        }
        return Integer.toString(value instanceof Map<?, ?> map ? map.size()
                : ((Collection<?>) value).size());
    }

    private static String describe(Object target, String name, String token) {
        Object value = field(target, name);
        List<String> out = new ArrayList<>();
        for (Object entry : (Collection<?>) value) {
            String text = String.valueOf(entry);
            out.add(entry.getClass().getSimpleName()
                    + (text.contains(token) ? "(contains lease token)" : "(" + text.length() + " chars, no token)"));
        }
        return out.toString();
    }

    private static boolean containsToken(Object target, String name, String token) {
        Object value = field(target, name);
        if (value == null) {
            return false;
        }
        Collection<?> entries = value instanceof Map<?, ?> map ? map.keySet()
                : (Collection<?>) value;
        for (Object entry : entries) {
            if (String.valueOf(entry).contains(token)) {
                return true;
            }
        }
        return false;
    }

    private static void print(String key, Object value) {
        System.out.println("RESULT " + key + " = " + value);
    }

    private static final class SimpleDataSource implements DataSource {
        private final String url;
        private final String user;
        private final String password;

        SimpleDataSource(String url, String user, String password) {
            this.url = url;
            this.user = user;
            this.password = password;
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
}
