package com.alibaba.qwen.code.managedagent.store;

import java.util.UUID;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * Verification-only (not part of the PR). Drives three migration directories through Flyway's API with
 * the module's defaults (no outOfOrder, no ignoreMigrationPatterns): main's published set (up to V64),
 * the PR head's set (main + V65), and a control with the same bytes named V58. Each cell uses a fresh
 * schema and prints one RESULT line.
 */
class MigrationOrderProbe {
    static final String DB = System.getProperty("probe.db", "?");
    static final String MAIN = System.getProperty("probe.mig.main");
    static final String HEAD = System.getProperty("probe.mig.head");
    static final String V58 = System.getProperty("probe.mig.v58");
    // main after another open PR's V66 lands first (synthetic V66), and that tree merged with this PR (V65 + V66).
    static final String MAIN66 = System.getProperty("probe.mig.main66");
    static final String HEAD66 = System.getProperty("probe.mig.head66");

    @Test
    void probe() {
        // Upgrade a database at main's published head.
        cell("upgrade-from-main-head", MAIN, HEAD, null);
        cell("upgrade-from-main-v58-control", MAIN, V58, null);
        cell("upgrade-after-v66-lands-first", MAIN66, HEAD66, null);
        // The PR's new acceptance test shape: target("64") on the PR's own set, then untargeted.
        cell("pr-test-shape-head", null, HEAD, "64");
        cell("pr-test-shape-v58", null, V58, "64");
        cell("pr-test-shape-after-v66", null, HEAD66, "64");
        // Rollback: main's broker on the upgraded (V65) schema.
        rollback();
    }

    void cell(String name, String base, String upgraded, String target) {
        try (var schema = new Schema()) {
            String phase1;
            if (target == null) {
                var first = flyway(schema.source, base, null).migrate();
                phase1 = "phase1=base executed=" + first.migrationsExecuted + " version=" + first.targetSchemaVersion;
            } else {
                var first = flyway(schema.source, upgraded, target).migrate();
                phase1 = "phase1=target" + target + " executed=" + first.migrationsExecuted + " version=" + first.targetSchemaVersion;
            }
            String phase2;
            try {
                var second = flyway(schema.source, upgraded, null).migrate();
                phase2 = "phase2=OK executed=" + second.migrationsExecuted + " version=" + second.targetSchemaVersion;
            } catch (RuntimeException error) {
                phase2 = "phase2=FAILED " + error.getClass().getSimpleName() + ":" + firstLine(error.getMessage());
            }
            result(name, phase1 + " | " + phase2 + " | ledgerTable=" + schema.ledgerTable() + " maxApplied=" + schema.maxApplied());
        }
    }

    void rollback() {
        try (var schema = new Schema()) {
            flyway(schema.source, MAIN, null).migrate();
            var up = flyway(schema.source, HEAD, null).migrate();
            String back;
            try {
                var again = flyway(schema.source, MAIN, null).migrate();
                back = "OK executed=" + again.migrationsExecuted;
            } catch (RuntimeException error) {
                back = "FAILED " + error.getClass().getSimpleName() + ":" + firstLine(error.getMessage());
            }
            result("rollback-main-on-v65", "upgrade executed=" + up.migrationsExecuted + " | main-broker-migrate=" + back
                    + " | maxApplied=" + schema.maxApplied());
        }
    }

    static Flyway flyway(DataSource source, String dir, String target) {
        // The module's two Java migrations (V15, V29) live on the classpath; a filesystem location cannot
        // resolve them, so hand them over explicitly to keep the resolved set identical to the broker's.
        var config = Flyway.configure().dataSource(source).locations("filesystem:" + dir)
                .javaMigrations(java("db.migration.V15__managed_event_identity"),
                        java("db.migration.V29__managed_hook_admission_backfill"));
        if (target != null) {
            config.target(target);
        }
        return config.load();
    }

    static org.flywaydb.core.api.migration.JavaMigration java(String name) {
        try {
            return (org.flywaydb.core.api.migration.JavaMigration) Class.forName(name).getDeclaredConstructor().newInstance();
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException(error);
        }
    }

    static String firstLine(String message) {
        if (message == null) {
            return "null";
        }
        return message.replace('\n', ' ').replaceAll("\\s+", " ").trim();
    }

    static void result(String cell, String body) {
        System.out.println("RESULT db=" + DB + " cell=" + cell + " " + body);
    }

    static final class Schema implements AutoCloseable {
        final JdbcTemplate admin;
        final String name;
        final DataSource source;

        Schema() {
            String url = System.getProperty("mysql.url");
            String user = System.getProperty("mysql.user");
            String password = System.getProperty("mysql.password", "");
            admin = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
            name = "migorder_" + UUID.randomUUID().toString().replace("-", "");
            admin.execute("CREATE DATABASE " + name);
            source = new DriverManagerDataSource(url.replaceFirst("/[^/?]+(?=\\?|$)", "/" + name), user, password);
        }

        int ledgerTable() {
            return admin.queryForObject("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?"
                    + " AND TABLE_NAME = 'qwen_managed_session_resource_collection'", Integer.class, name);
        }

        String maxApplied() {
            return new JdbcTemplate(source).queryForObject("SELECT MAX(CAST(version AS UNSIGNED)) FROM flyway_schema_history"
                    + " WHERE success = TRUE", String.class);
        }

        @Override public void close() {
            admin.execute("DROP DATABASE " + name);
        }
    }
}
