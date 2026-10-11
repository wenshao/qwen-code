package com.alibaba.qwen.code.managedagent.store;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Random;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

/** Verification rig driver: real HTTP producer calls, the production retirement transaction, recovery reads. */
public final class E2ETool {
    static final ObjectMapper JSON = new ObjectMapper();
    static final HttpClient HTTP = HttpClient.newHttpClient();
    static final String TOKEN = "e2e-writer-token-0123456789abcdef";

    public static void main(String[] args) throws Exception {
        String db = System.getProperty("db");
        var source = new DriverManagerDataSource("jdbc:mysql://" + System.getProperty("dbhost", "mysql84:3306") + "/" + db
                + "?allowPublicKeyRetrieval=true&useSSL=false", "root", "verify");
        var jdbc = new JdbcTemplate(source);
        switch (args[0]) {
            case "seed" -> seed(args[1], args[2], args[3], args[4], Integer.parseInt(args[5]), Integer.parseInt(args[6]),
                    Integer.parseInt(args[7]), Integer.parseInt(args[8]), args.length > 9 && Boolean.parseBoolean(args[9]));
            case "retire" -> {
                var tx = new TransactionTemplate(new DataSourceTransactionManager(source));
                long t0 = System.currentTimeMillis();
                tx.executeWithoutResult(status -> {
                    ToolPublicationRetentionStore.lockDeletion(jdbc, args[1], args[2]);
                    ToolPublicationRetentionStore.retire(jdbc, args[1], args[2], args[3]);
                });
                System.out.println("retired " + args[2] + " in " + (System.currentTimeMillis() - t0) + "ms");
            }
            case "retire-many" -> {
                var tx = new TransactionTemplate(new DataSourceTransactionManager(source));
                for (int i = 1; i + 1 < args.length; i += 2) {
                    String tenant = args[i];
                    String session = args[i + 1];
                    tx.executeWithoutResult(status -> {
                        ToolPublicationRetentionStore.lockDeletion(jdbc, tenant, session);
                        ToolPublicationRetentionStore.retire(jdbc, tenant, session, "delete-" + session);
                    });
                }
                System.out.println("retired " + (args.length - 1) / 2 + " sessions at " + System.currentTimeMillis());
            }
            case "read" -> System.out.println(read(args[1], args[2], args[3], args[4]));
            case "recovery" -> System.out.println(recovery(jdbc, args[1], args[2], args[3], args[4]));
            case "killer" -> killer(jdbc, args[1], Long.parseLong(args[2]), Long.parseLong(args[3]), Integer.parseInt(args[4]));
            case "killer-between" -> {
                long deadline = System.currentTimeMillis() + Integer.parseInt(args[3]) * 1000L;
                while (System.currentTimeMillis() < deadline) {
                    var hits = jdbc.queryForList("SELECT session_id, gc_generation, gc_cursor, collected_bytes, gc_claim_until"
                            + " FROM qwen_managed_session_resource_collection WHERE gc_owner = ? AND gc_cursor <> ''"
                            + " AND collected_at IS NULL", args[2]);
                    if (!hits.isEmpty()) {
                        new ProcessBuilder("kill", "-9", args[1]).inheritIO().start().waitFor();
                        System.out.println("KILLED pid=" + args[1] + " between pages, ledger=" + hits.getFirst());
                        return;
                    }
                    Thread.sleep(5);
                }
                System.out.println("NO HIT");
            }
            default -> throw new IllegalArgumentException(args[0]);
        }
    }

    static String base(String port, String session) {
        return "http://127.0.0.1:" + port + "/internal/managed-session-store/v1/sessions/" + session;
    }

    static HttpResponse<String> post(String url, String tenant, JsonNode body) throws Exception {
        return HTTP.send(HttpRequest.newBuilder(URI.create(url)).header("X-Qwen-Tenant-Id", tenant)
                .header("X-Qwen-Managed-Writer-Token", TOKEN).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body.toString())).build(), HttpResponse.BodyHandlers.ofString());
    }

    /** seed <port> <tenant> <workspace> <session> <contents(1MiB)> <pages(2KiB)> <manifests(1KiB)> <seed> [blockRecovery] */
    static void seed(String port, String tenant, String workspace, String session, int contents, int pages,
            int manifests, int seed, boolean blockRecovery) throws Exception {
        var acquire = post(base(port, session) + "/writers:acquire", tenant, JSON.createObjectNode()
                .put("workspaceId", workspace).put("writerId", "bg-shell").put("leaseMillis", 60_000));
        require(acquire, 200);
        long generation = JSON.readTree(acquire.body()).path("writerGeneration").asLong();
        var random = new Random(seed);
        long bytes = 0;
        int rows = 0;
        for (int kind = 0; kind < 3; kind++) {
            int count = kind == 0 ? contents : kind == 1 ? pages : manifests;
            for (int i = 0; i < count; i++) {
                String k = kind == 0 ? "managed-tool-result-content" : kind == 1 ? "managed-tool-result-page"
                        : "managed-tool-result-manifest";
                byte[] data = new byte[kind == 0 ? 1024 * 1024 : kind == 1 ? 2048 : 1024];
                random.nextBytes(data);
                String id = sha256((session + "/" + k + "/" + i).getBytes());
                ObjectNode body = JSON.createObjectNode().put("workspaceId", workspace).put("writerId", "bg-shell")
                        .put("writerGeneration", generation).put("resourceId", id).put("kind", k)
                        .put("schemaVersion", 1).put("byteLength", data.length).put("digest", sha256(data))
                        .put("bytesBase64", Base64.getEncoder().encodeToString(data));
                require(post(base(port, session) + "/tool-results:publish", tenant, body), 200);
                bytes += data.length;
                rows++;
            }
        }
        String first = sha256((session + "/managed-tool-result-" + (contents > 0 ? "content" : "page") + "/0").getBytes());
        if (rows > 0) {
            System.out.println("pre-seal read " + first.substring(0, 12) + ": " + read(port, tenant, workspace, session + "/" + first));
        }
        if (blockRecovery) {
            require(post(base(port, session) + "/recovery:block", tenant, JSON.createObjectNode().put("workspaceId", workspace)
                    .put("writerId", "bg-shell").put("writerGeneration", generation)
                    .put("recoveryStatus", "BLOCKED_RESOURCE").put("recoveryDetailCode", "e2e_blocked")), 200);
        }
        require(post(base(port, session) + "/writers:seal", tenant, JSON.createObjectNode().put("workspaceId", workspace)
                .put("writerId", "bg-shell").put("writerGeneration", generation)), 200);
        System.out.println("seeded session=" + session + " rows=" + rows + " bytes=" + bytes);
    }

    static String read(String port, String tenant, String workspace, String sessionAndResource) throws Exception {
        String[] parts = sessionAndResource.split("/", 2);
        var response = HTTP.send(HttpRequest.newBuilder(URI.create(base(port, parts[0]) + "/resources/" + parts[1]
                        + "?workspaceId=" + workspace)).header("X-Qwen-Tenant-Id", tenant)
                .header("X-Qwen-Managed-Writer-Token", TOKEN).GET().build(), HttpResponse.BodyHandlers.ofByteArray());
        String body = response.statusCode() == 200 ? ("<" + response.body().length + " bytes sha256="
                + sha256(response.body()) + ">") : new String(response.body());
        return "HTTP " + response.statusCode() + " " + body;
    }

    static String recovery(JdbcTemplate jdbc, String tenant, String workspace, String session, String resource) {
        var row = jdbc.queryForMap("SELECT kind, schema_version, byte_length, sha256 FROM qwen_managed_session_resource"
                + " WHERE tenant_id = ? AND session_id = ? AND resource_id = ?", tenant, session, resource);
        ObjectNode source = JSON.createObjectNode();
        source.putObject("head").put("tenantId", tenant).put("workspaceId", workspace).put("sessionId", session)
                .put("journalRevision", 0);
        ObjectNode ref = JSON.createObjectNode().put("resourceId", resource).put("kind", (String) row.get("kind"))
                .put("schemaVersion", ((Number) row.get("schema_version")).intValue())
                .put("byteLength", ((Number) row.get("byte_length")).longValue()).put("digest", (String) row.get("sha256"));
        try {
            JsonNode value = new WorkspaceRecoveryReader(jdbc, null).resource(source, ref);
            return "OK bytes=" + Base64.getDecoder().decode(value.path("bytesBase64").asText()).length;
        } catch (RuntimeException error) {
            return "REFUSED " + error.getClass().getSimpleName() + ": " + error.getMessage();
        }
    }

    /** killer <program_name> <pid> <minRowsModified> <timeoutSeconds>: kill -9 the instance inside an uncommitted page. */
    static void killer(JdbcTemplate jdbc, String program, long pid, long minRows, int timeoutSeconds) throws Exception {
        long deadline = System.currentTimeMillis() + timeoutSeconds * 1000L;
        String probe = "SELECT t.trx_id, t.trx_rows_modified, t.trx_mysql_thread_id, t.trx_query FROM information_schema.innodb_trx t"
                + " JOIN performance_schema.session_connect_attrs a ON a.PROCESSLIST_ID = t.trx_mysql_thread_id"
                + " AND a.ATTR_NAME = 'program_name' WHERE a.ATTR_VALUE = ? AND t.trx_rows_modified >= ?";
        long polls = 0;
        while (System.currentTimeMillis() < deadline) {
            polls++;
            var hits = jdbc.queryForList(probe, program, minRows);
            if (!hits.isEmpty()) {
                new ProcessBuilder("kill", "-9", Long.toString(pid)).inheritIO().start().waitFor();
                System.out.println("KILLED pid=" + pid + " after " + polls + " polls inside uncommitted trx " + hits.getFirst());
                Thread.sleep(1500);
                System.out.println("trx after kill (same thread): " + jdbc.queryForList(
                        "SELECT trx_id, trx_state, trx_rows_modified FROM information_schema.innodb_trx WHERE trx_mysql_thread_id = ?",
                        hits.getFirst().get("trx_mysql_thread_id")));
                return;
            }
            Thread.sleep(200); // INNODB_TRX is a cache refreshed only after 100 ms without reads
        }
        System.out.println("NO HIT after " + polls + " polls");
    }

    static void require(HttpResponse<String> response, int status) {
        if (response.statusCode() != status) {
            throw new IllegalStateException("HTTP " + response.statusCode() + ": " + response.body());
        }
    }

    static String sha256(byte[] value) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value));
    }
}
