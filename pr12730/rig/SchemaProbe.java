package com.alibaba.qwen.code.runtimebroker;

import com.mysql.cj.jdbc.MysqlDataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;

/**
 * Schema probes that only use API present on main, the pre-fix commit and
 * head, so one class runs against each arm's classes.
 */
public final class SchemaProbe {
    static final SecretProtector PROTECTOR = new AesGcmSecretProtector("rig-key", new byte[32]);

    public static void main(String[] args) throws Exception {
        switch (args[0]) {
            case "race" -> race(args[1], Path.of(args[2]), Integer.parseInt(args[3]),
                    Integer.parseInt(args[4]));
            case "legacy-create" -> legacyCreate(args[1]);
            case "legacy-read" -> legacyRead(args[1]);
            case "old-reads-managed" -> oldReadsManaged(args[1], args[2]);
            default -> throw new IllegalArgumentException(args[0]);
        }
        Runtime.getRuntime().halt(0);
    }

    static DataSource ds(String db) {
        MysqlDataSource source = new MysqlDataSource();
        source.setURL("jdbc:mysql://127.0.0.1:13730/" + db);
        source.setUser("root");
        source.setPassword("");
        return source;
    }

    static void exec(String sql) throws Exception {
        try (Connection connection = ds("mysql").getConnection();
                Statement statement = connection.createStatement()) {
            for (String part : sql.split(";")) {
                if (!part.isBlank()) {
                    statement.execute(part);
                }
            }
        }
    }

    /** Six initializers at once on a schema created from main's schema.sql. */
    static void race(String arm, Path mainSchema, int rounds, int threads) throws Exception {
        String schema = Files.readString(mainSchema);
        Map<String, Integer> errors = new TreeMap<>();
        int failures = 0;
        for (int round = 1; round <= rounds; round++) {
            String db = "race_" + arm + "_" + round;
            exec("DROP DATABASE IF EXISTS " + db + "; CREATE DATABASE " + db);
            try (Connection connection = ds(db).getConnection();
                    Statement statement = connection.createStatement()) {
                for (String part : schema.split(";")) {
                    if (!part.isBlank()) {
                        statement.execute(part);
                    }
                }
            }
            DataSource source = ds(db);
            CyclicBarrier barrier = new CyclicBarrier(threads);
            ExecutorService pool = Executors.newFixedThreadPool(threads);
            List<Future<String>> results = new ArrayList<>();
            for (int index = 0; index < threads; index++) {
                results.add(pool.submit(() -> {
                    barrier.await();
                    try {
                        JdbcRuntimeBrokerSchema.initialize(source);
                        return null;
                    } catch (RuntimeException failure) {
                        Throwable root = failure;
                        while (root.getCause() != null) {
                            root = root.getCause();
                        }
                        return root.getClass().getSimpleName() + ": " + root.getMessage();
                    }
                }));
            }
            int roundFailures = 0;
            for (Future<String> result : results) {
                String error = result.get();
                if (error != null) {
                    roundFailures++;
                    errors.merge(error, 1, Integer::sum);
                }
            }
            pool.shutdown();
            int columns = 0;
            try (Connection connection = source.getConnection();
                    Statement statement = connection.createStatement();
                    ResultSet result = statement.executeQuery(
                            "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = '"
                                    + db + "' AND column_name = 'storage_id'")) {
                result.next();
                columns = result.getInt(1);
            }
            System.out.printf("%-7s round %d: %d/%d initialize calls failed; storage_id columns now=%d%n",
                    arm, round, roundFailures, threads, columns);
            failures += roundFailures;
        }
        System.out.printf("%-7s TOTAL: %d/%d failed%n", arm, failures, rounds * threads);
        errors.forEach((error, count) -> System.out.printf("%-7s   %dx %s%n", arm, count, error));
    }

    static RuntimeProvisionRequest legacyRequest(String isolationKey, String isolation) {
        return new RuntimeProvisionRequest(new RuntimeScope("tenant-a", "workspace-a", "7",
                "/srv/legacy-workspace", "sha256:" + "c".repeat(64), isolation), isolationKey,
                "local-process");
    }

    static void legacyCreate(String db) throws Exception {
        exec("DROP DATABASE IF EXISTS " + db + "; CREATE DATABASE " + db);
        DataSource source = ds(db);
        JdbcRuntimeBrokerSchema.initialize(source);
        JdbcRuntimeBindingRepository repository = new JdbcRuntimeBindingRepository(source, PROTECTOR);
        RuntimeBindingRecord record = repository.findOrCreate(legacyRequest(null, "workspace"));
        System.out.println("main created legacy binding " + record.getBindingId()
                + " state=" + record.getState());
        dumpKeys(source);
    }

    static void legacyRead(String db) throws Exception {
        DataSource source = ds(db);
        JdbcRuntimeBrokerSchema.initialize(source);
        JdbcRuntimeBindingRepository repository = new JdbcRuntimeBindingRepository(source, PROTECTOR);
        RuntimeBindingRecord active = repository.findActive(legacyRequest(null, "workspace"));
        RuntimeBindingRecord again = repository.findOrCreate(legacyRequest(null, "workspace"));
        System.out.println("head after upgrade: findActive -> " + active.getBindingId()
                + " state=" + active.getState() + "; findOrCreate returns the same binding: "
                + active.getBindingId().equals(again.getBindingId()));
        dumpKeys(source);
    }

    static void oldReadsManaged(String db, String isolationKey) throws Exception {
        DataSource source = ds(db);
        JdbcRuntimeBindingRepository repository = new JdbcRuntimeBindingRepository(source, PROTECTOR);
        String root = System.getenv("ROOT");
        RuntimeProvisionRequest request = new RuntimeProvisionRequest(new RuntimeScope(
                "tenant-a", "workspace-a", "7", root, "sha256:" + "c".repeat(64), "session"),
                isolationKey, "local-process");
        String managedId;
        try (Connection connection = source.getConnection();
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery(
                        "SELECT binding_id FROM qwen_runtime_binding WHERE isolation_key = '"
                                + isolationKey + "'")) {
            result.next();
            managedId = result.getString(1);
        }
        try {
            RuntimeBindingRecord byId = repository.findById(managedId);
            System.out.println("old binary findById(managed binding) -> " + byId.getState()
                    + " request=" + byId.getRequest().getProvisionerKind());
        } catch (RuntimeException failure) {
            System.out.println("old binary findById(managed binding) -> "
                    + failure.getClass().getSimpleName() + ": " + failure.getMessage());
        }
        RuntimeBindingRecord active = repository.findActive(request);
        System.out.println("old binary findActive(same scope, legacy request) -> "
                + (active == null ? "null (managed slot not visible)" : active.getBindingId()));
        RuntimeBindingRecord created = repository.findOrCreate(request);
        System.out.println("old binary findOrCreate(same scope) -> new binding "
                + created.getBindingId().equals(managedId) + "? state=" + created.getState()
                + " id=" + created.getBindingId());
        dumpKeys(source);
    }

    static void dumpKeys(DataSource source) throws Exception {
        try (Connection connection = source.getConnection();
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery(
                        "SELECT b.binding_id, b.binding_state, b.request_key, b.isolation_key, "
                                + "(SELECT COUNT(*) FROM information_schema.columns c WHERE "
                                + "c.table_schema = DATABASE() AND c.table_name = 'qwen_runtime_binding' "
                                + "AND c.column_name = 'storage_id') AS has_col "
                                + "FROM qwen_runtime_binding b ORDER BY b.last_active_at")) {
            while (result.next()) {
                System.out.println("   row " + result.getString(1).substring(0, 8) + "… state="
                        + result.getString(2) + " iso=" + result.getString(4)
                        + " request_key=" + result.getString(3)
                        + " storage_id column present=" + (result.getInt(5) == 1));
            }
        }
    }
}
