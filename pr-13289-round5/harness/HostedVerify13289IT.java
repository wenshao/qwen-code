package com.alibaba.qwen.code.managedagent;

import static org.assertj.core.api.Assertions.assertThat;

import com.alibaba.qwen.code.managedagent.api.WorkspaceSelection;
import com.alibaba.qwen.code.managedagent.service.EmbeddedRuntimeBroker;
import com.alibaba.qwen.code.managedagent.store.ManagedAgentStore;
import com.alibaba.qwen.code.runtimebroker.AesGcmSecretProtector;
import com.alibaba.qwen.code.runtimebroker.JdbcRuntimeBindingRepository;
import com.alibaba.qwen.code.runtimebroker.RuntimeBindingRecord;
import com.alibaba.qwen.code.runtimebroker.RuntimeBrokerException;
import com.alibaba.qwen.code.runtimebroker.RuntimeProvisionRequest;
import com.alibaba.qwen.code.runtimebroker.WorkspaceExecutionProfile;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.FileTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * PR #13289 maintainer verification (scratch, not part of the PR).
 *
 * Real Spring Session Store + embedded Runtime Broker + bundled durable
 * local-process workers + MySQL/MariaDB with the production Runtime Broker
 * defaults (durable workers, trusted reboot recovery on, verified Workspace
 * recovery off). Two phases share one database, one state directory and one
 * set of Workspace roots:
 *   phase 1: boot A. Turns, operator CSI registration, then every worker is
 *            killed (what a host reboot does to them).
 *   phase 2: boot B. The run script starts this JVM in a private mount
 *            namespace whose /proc/sys/kernel/random/boot_id is a fresh UUID,
 *            i.e. the Broker observes a rebooted host.
 */
class HostedVerify13289IT {
    private static final String KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

    @Test
    @Timeout(1500)
    @SuppressWarnings("unchecked")
    void localBindingWithoutLeaseRowAndCsiAlias() throws Exception {
        int phase = Integer.getInteger("verify.phase", 1);
        List<String> cases = List.of(System.getProperty("verify.cases", "warmreg,warmnoreg,toolfirst").split(","));
        Path base = Path.of(System.getProperty("verify.base")).toRealPath();
        Path cli = Path.of(System.getProperty("qwen.cli.entry")).toAbsolutePath().normalize();
        assertThat(cli).isRegularFile();
        String node = System.getProperty("node.executable");
        Path temporary = base.resolve("roots");
        Path state = base.resolve("runtime-state");
        Path root = cli.getParent().getParent();
        ObjectMapper mapper = new ObjectMapper();
        Path worker = base.resolve("verify13289-worker.mjs");
        Path sessionsFile = base.resolve("sessions.json");
        String tenant = System.getProperty("verify.tenant");
        List<Path> workspaces = new ArrayList<>();
        for (String name : cases) workspaces.add(temporary.resolve(name));
        if (phase == 1) {
            // A per-run worker entry makes this run's workers identifiable in `ps`.
            Files.writeString(worker, "process.argv[1] = " + mapper.writeValueAsString(cli.toString())
                    + ";\nawait import(" + mapper.writeValueAsString(cli.toUri().toString()) + ");\n");
            Files.createDirectories(temporary);
            for (Path workspace : workspaces) {
                Files.createDirectory(workspace);
                Files.createDirectory(workspace.resolve("child"));
                Files.setLastModifiedTime(workspace, FileTime.fromMillis(1));
            }
        }
        var arguments = new ArrayList<>(List.of(
                "--server.address=127.0.0.1", "--server.port=0",
                "--spring.datasource.url=" + System.getProperty("mysql.url"),
                "--spring.datasource.driver-class-name=com.mysql.cj.jdbc.Driver",
                "--spring.datasource.username=" + System.getProperty("mysql.user"),
                "--spring.datasource.password=" + System.getProperty("mysql.password", ""),
                "--qwen.managed-agent.session-store.enabled=true",
                "--qwen.managed-agent.harness.enabled=false",
                "--qwen.managed-agent.harness.capability-digest=sha256:" + "a".repeat(64),
                "--qwen.managed-agent.runtime-broker.enabled=true",
                "--qwen.managed-agent.runtime-broker.port=0",
                "--qwen.managed-agent.runtime-broker.token=hosted-tools-broker-token",
                // Production defaults (application.yml): durable workers with trusted reboot recovery.
                "--qwen.managed-agent.runtime-broker.durable-local-process=true",
                "--qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=true",
                "--qwen.managed-agent.runtime-broker.verified-workspace-recovery-enabled=false",
                "--qwen.managed-agent.runtime-broker.workspace-cwd=" + temporary,
                "--qwen.managed-agent.runtime-broker.state-directory=" + state,
                "--qwen.managed-agent.runtime-broker.credential-key-id=test",
                "--qwen.managed-agent.runtime-broker.credential-key=" + KEY,
                "--qwen.managed-agent.runtime-broker.node-executable=" + node,
                "--qwen.managed-agent.runtime-broker.worker-entry=" + worker,
                "--qwen.managed-agent.runtime-broker.cli-entry=" + cli));
        for (int index = 0; index < workspaces.size(); index++) {
            String prefix = "--qwen.managed-agent.runtime-broker.workspace-mounts[" + index + "].";
            arguments.add(prefix + "tenant-id=" + tenant);
            arguments.add(prefix + "storage-id=storage-" + cases.get(index));
            arguments.add(prefix + "root=" + workspaces.get(index));
        }
        Path out = Path.of(System.getProperty("verify.out"));
        Files.createDirectories(out);
        try (var spring = (ServletWebServerApplicationContext) new SpringApplicationBuilder(
                ManagedAgentServerApplication.class).run(arguments.toArray(String[]::new))) {
            JdbcTemplate jdbc = spring.getBean(JdbcTemplate.class);
            Map<String, Object> database = jdbc.queryForMap("SELECT VERSION() AS version, @@version_comment AS engine");
            System.out.println("VERIFY13289_DATABASE phase=" + phase + " " + database + " bootId="
                    + Files.readString(Path.of("/proc/sys/kernel/random/boot_id")).strip());
            var caseConfigs = new ArrayList<Map<String, Object>>();
            if (phase == 1) {
                ManagedAgentStore store = spring.getBean(ManagedAgentStore.class);
                for (int index = 0; index < workspaces.size(); index++) {
                    String name = cases.get(index);
                    String workspaceId = "workspace-" + name;
                    jdbc.update("INSERT INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation,"
                            + " storage_id, display_name, config_ref, policy_ref, state) VALUES (?, ?, 1, ?,"
                            + " 'Workspace', ?, ?, 'ACTIVE')", tenant, workspaceId, "storage-" + name,
                            WorkspaceExecutionProfile.CONFIG_REF, WorkspaceExecutionProfile.POLICY_REF);
                    jdbc.update("INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create)"
                            + " VALUES (?, ?, ?, TRUE, TRUE)", tenant, workspaceId, "actor".getBytes(StandardCharsets.UTF_8));
                    var sessionIds = new ArrayList<String>();
                    for (String role : List.of("1", "2")) {
                        sessionIds.add(store.insertWorkspaceSessionCommand(tenant, "actor", "create-" + name + "-" + role,
                                "sha256:" + "a".repeat(64), "qwen-code", null, null, List.of(), null,
                                new WorkspaceSelection(workspaceId, "child")).sessionId());
                    }
                    caseConfigs.add(Map.of("name", name, "workspaceId", workspaceId,
                            "storageId", "storage-" + name, "directory", workspaces.get(index).resolve("child").toString(),
                            "sessions", sessionIds));
                }
                mapper.writeValue(sessionsFile.toFile(), caseConfigs);
            } else {
                for (Map<?, ?> entry : mapper.readValue(sessionsFile.toFile(), Map[].class)) {
                    caseConfigs.add((Map<String, Object>) entry);
                }
            }
            // Read-only SQL endpoint so the driver can observe durable state between steps.
            HttpServer sql = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            sql.createContext("/query", exchange -> {
                byte[] reply;
                int status = 200;
                try {
                    String query = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                    if (!query.stripLeading().toUpperCase().startsWith("SELECT")) throw new IllegalArgumentException("SELECT only");
                    reply = mapper.writeValueAsBytes(jdbc.queryForList(query));
                } catch (Exception error) {
                    status = 500;
                    reply = String.valueOf(error).getBytes(StandardCharsets.UTF_8);
                }
                exchange.sendResponseHeaders(status, reply.length);
                exchange.getResponseBody().write(reply);
                exchange.close();
            });
            sql.start();
            EmbeddedRuntimeBroker broker = spring.getBean(EmbeddedRuntimeBroker.class);
            Path config = base.resolve("driver-phase" + phase + ".json");
            var driverConfig = new LinkedHashMap<String, Object>();
            driverConfig.put("phase", phase);
            driverConfig.put("tenantId", tenant);
            driverConfig.put("cases", caseConfigs);
            driverConfig.put("database", database.toString());
            driverConfig.put("storeUrl", "http://127.0.0.1:" + spring.getWebServer().getPort());
            driverConfig.put("brokerUrl", broker.getBaseUri().toString());
            driverConfig.put("sqlUrl", "http://127.0.0.1:" + sql.getAddress().getPort() + "/query");
            driverConfig.put("java", ProcessHandle.current().info().command().orElseThrow());
            driverConfig.put("classpath", System.getProperty("java.class.path"));
            driverConfig.put("jdbcUrl", System.getProperty("mysql.url"));
            driverConfig.put("jdbcUser", System.getProperty("mysql.user"));
            driverConfig.put("jdbcPassword", System.getProperty("mysql.password", ""));
            driverConfig.put("workerEntry", worker.toString());
            driverConfig.put("observeSeconds", Integer.getInteger("verify.observeSeconds", 90));
            mapper.writeValue(config.toFile(), driverConfig);
            Path log = out.resolve("driver-phase" + phase + ".log");
            Process driver = new ProcessBuilder(node, "--import", "tsx",
                    "integration-tests/helpers/hosted-verify13289-driver.ts", config.toString())
                    .directory(root.toFile()).redirectErrorStream(true).redirectOutput(log.toFile()).start();
            try {
                assertThat(driver.waitFor(1300, TimeUnit.SECONDS)).as("Driver timeout: %s", Files.readString(log)).isTrue();
                System.out.println(Files.readString(log));
                if (Files.exists(Path.of(config + ".results"))) {
                    Files.copy(Path.of(config + ".results"), out.resolve("driver-phase" + phase + "-results.json"),
                            StandardCopyOption.REPLACE_EXISTING);
                }
                if (phase == 2) {
                    // Placement admission probe on the same database: would a NEW placement for the
                    // same tenant+storage (the CSI kind the operator registered, or LOCAL) be admitted?
                    var probes = new ArrayList<Map<String, Object>>();
                    var bindings = new JdbcRuntimeBindingRepository(spring.getBean(DataSource.class),
                            AesGcmSecretProtector.fromBase64("test", KEY));
                    for (Map<String, Object> entry : caseConfigs) {
                        String storage = entry.get("storageId").toString();
                        var rows = jdbc.queryForList("SELECT binding_id FROM qwen_runtime_binding WHERE tenant_id = ?"
                                + " AND storage_id = ? ORDER BY runtime_generation", tenant, storage);
                        RuntimeBindingRecord original = bindings.findById(rows.getFirst().get("binding_id").toString());
                        var probe = new LinkedHashMap<String, Object>();
                        probe.put("case", entry.get("name"));
                        probe.put("originalState", original.getState().name());
                        for (String kind : List.of("kubernetes-workspace", "local-process")) {
                            var candidate = new RuntimeProvisionRequest(original.getRequest().getScope(),
                                    "probe-" + UUID.randomUUID(), kind, storage);
                            try {
                                RuntimeBindingRecord created = bindings.findOrCreate(candidate);
                                probe.put(kind, "admitted:" + created.getState().name());
                            } catch (RuntimeBrokerException error) {
                                probe.put(kind, "refused:" + error.getStatusCode() + ":" + error.getCode());
                            } catch (RuntimeException error) {
                                probe.put(kind, "error:" + error);
                            }
                        }
                        probes.add(probe);
                    }
                    System.out.println("VERIFY13289_PLACEMENT_PROBE " + mapper.writeValueAsString(probes));
                    Files.writeString(out.resolve("placement-probe.json"),
                            mapper.writerWithDefaultPrettyPrinter().writeValueAsString(probes));
                }
                Files.writeString(out.resolve("bindings-phase" + phase + ".json"), mapper.writerWithDefaultPrettyPrinter()
                        .writeValueAsString(jdbc.queryForList("SELECT storage_id, binding_id, runtime_generation,"
                                + " provisioner_kind, binding_state, record_version,"
                                + " JSON_UNQUOTE(JSON_EXTRACT(loss_evidence_json, '$.source')) AS loss_source,"
                                + " JSON_UNQUOTE(JSON_EXTRACT(stop_evidence_json, '$.source')) AS stop_source"
                                + " FROM qwen_runtime_binding WHERE tenant_id = ? ORDER BY storage_id, runtime_generation",
                                tenant)));
                assertThat(driver.exitValue()).as("Driver output: %s", Files.readString(log)).isZero();
                assertThat(Files.readString(log)).contains("HOSTED_VERIFY13289_OK");
            } finally {
                driver.descendants().forEach(ProcessHandle::destroyForcibly);
                if (driver.isAlive()) driver.destroyForcibly();
                sql.stop(0);
            }
        } finally {
            // Durable workers outlive the JVM by design; stop this run's workers.
            ProcessHandle.allProcesses().filter(handle -> handle.info().arguments()
                    .map(args -> List.of(args).contains(worker.toString())).orElse(false))
                    .forEach(ProcessHandle::destroyForcibly);
        }
    }
}
