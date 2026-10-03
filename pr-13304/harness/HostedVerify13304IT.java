package com.alibaba.qwen.code.managedagent;

import static org.assertj.core.api.Assertions.assertThat;

import com.alibaba.qwen.code.managedagent.api.WorkspaceSelection;
import com.alibaba.qwen.code.managedagent.service.EmbeddedRuntimeBroker;
import com.alibaba.qwen.code.managedagent.store.ManagedAgentStore;
import com.alibaba.qwen.code.runtimebroker.WorkspaceExecutionProfile;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;

/** PR #13304 maintainer verification (scratch, not part of the PR). */
class HostedVerify13304IT {
    @TempDir
    private Path temporary;

    @Test
    @Timeout(480)
    void ackReplayAndDrainAvailabilityOnRealBrokerWorkerAndMySql() throws Exception {
        List<String> cases = List.of(System.getProperty("verify.cases", "ack-loss,drain-delete,drain-overlap")
                .split(","));
        Path cli = Path.of(System.getProperty("qwen.cli.entry")).toAbsolutePath().normalize();
        assertThat(cli).isRegularFile();
        String node = System.getProperty("node.executable");
        temporary = temporary.toRealPath();
        Files.createDirectory(temporary.resolve("runtime"));
        Path root = cli.getParent().getParent();
        String tenant = "verify13304-" + UUID.randomUUID();
        List<Path> workspaces = new ArrayList<>();
        for (String name : cases) workspaces.add(Files.createDirectory(temporary.resolve(name)));
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
                "--qwen.managed-agent.runtime-broker.durable-local-process=false",
                "--qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false",
                "--qwen.managed-agent.runtime-broker.workspace-cwd=" + temporary,
                "--qwen.managed-agent.runtime-broker.state-directory=" + temporary.resolve("runtime"),
                "--qwen.managed-agent.runtime-broker.credential-key-id=test",
                "--qwen.managed-agent.runtime-broker.credential-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                "--qwen.managed-agent.runtime-broker.node-executable=" + node,
                "--qwen.managed-agent.runtime-broker.worker-entry=" + cli,
                "--qwen.managed-agent.runtime-broker.cli-entry=" + cli,
                "--qwen.managed-agent.runtime-broker.verified-workspace-recovery-enabled=false"));
        for (int index = 0; index < workspaces.size(); index++) {
            String prefix = "--qwen.managed-agent.runtime-broker.workspace-mounts[" + index + "].";
            arguments.add(prefix + "tenant-id=" + tenant);
            arguments.add(prefix + "storage-id=storage-" + index);
            arguments.add(prefix + "root=" + workspaces.get(index));
            Files.createDirectory(workspaces.get(index).resolve("child"));
            Files.setLastModifiedTime(workspaces.get(index), FileTime.fromMillis(1));
        }
        try (var spring = (ServletWebServerApplicationContext) new SpringApplicationBuilder(
                ManagedAgentServerApplication.class).run(arguments.toArray(String[]::new))) {
            JdbcTemplate jdbc = spring.getBean(JdbcTemplate.class);
            System.out.println("VERIFY13304_DATABASE " + jdbc.queryForMap(
                    "SELECT VERSION() AS version, @@version_comment AS engine"));
            ManagedAgentStore store = spring.getBean(ManagedAgentStore.class);
            var sessions = new ArrayList<Map<String, Object>>();
            for (int index = 0; index < workspaces.size(); index++) {
                String workspaceId = "workspace-" + index;
                jdbc.update("INSERT INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation,"
                        + " storage_id, display_name, config_ref, policy_ref, state) VALUES (?, ?, 1, ?,"
                        + " 'Workspace', ?, ?, 'ACTIVE')", tenant, workspaceId, "storage-" + index,
                        WorkspaceExecutionProfile.CONFIG_REF, WorkspaceExecutionProfile.POLICY_REF);
                jdbc.update("INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create)"
                        + " VALUES (?, ?, ?, TRUE, TRUE)", tenant, workspaceId, "actor".getBytes(StandardCharsets.UTF_8));
                var created = store.insertWorkspaceSessionCommand(tenant, "actor", "create-" + index,
                        "sha256:" + "a".repeat(64), "qwen-code", null, null, List.of(), null,
                        new WorkspaceSelection(workspaceId, "child"));
                sessions.add(Map.of("sessionId", created.sessionId(), "workspaceId", workspaceId,
                        "directory", workspaces.get(index).resolve("child").toString(), "fault", cases.get(index)));
            }
            EmbeddedRuntimeBroker broker = spring.getBean(EmbeddedRuntimeBroker.class);
            Path config = temporary.resolve("driver.json");
            new ObjectMapper().writeValue(config.toFile(), Map.of("tenantId", tenant, "sessions", sessions,
                    "storeUrl", "http://127.0.0.1:" + spring.getWebServer().getPort(),
                    "brokerUrl", broker.getBaseUri().toString()));
            Path log = temporary.resolve("driver.log");
            Process driver = new ProcessBuilder(node, "--import", "tsx",
                    "integration-tests/helpers/hosted-verify13304-driver.ts", config.toString())
                    .directory(root.toFile()).redirectErrorStream(true).redirectOutput(log.toFile()).start();
            try {
                assertThat(driver.waitFor(400, TimeUnit.SECONDS)).as("Driver timeout: %s", Files.readString(log)).isTrue();
                System.out.println(Files.readString(log));
                assertThat(driver.exitValue()).as("Driver output: %s", Files.readString(log)).isZero();
                assertThat(Files.readString(log)).contains("HOSTED_VERIFY13304_OK");
            } finally {
                driver.descendants().forEach(ProcessHandle::destroyForcibly);
                if (driver.isAlive()) driver.destroyForcibly();
            }
            // Durable evidence from MySQL, per Session.
            var evidence = new ArrayList<Map<String, Object>>();
            for (Map<String, Object> session : sessions) {
                Object id = session.get("sessionId");
                var row = new LinkedHashMap<String, Object>();
                row.put("fault", session.get("fault"));
                row.put("sessionId", id);
                row.put("toolExecutions", jdbc.queryForList("SELECT turn_id, tool_call_id, execution_state, execution_status, dispatch_generation"
                        + " FROM qwen_tool_execution WHERE harness_session_id = ? ORDER BY settled_at", id));
                row.put("journalOperations", jdbc.queryForList("SELECT operation, COUNT(*) AS n"
                        + " FROM qwen_managed_session_journal_tx WHERE tenant_id = ? AND session_id = ?"
                        + " GROUP BY operation ORDER BY operation", tenant, id));
                evidence.add(row);
            }
            Path out = Path.of(System.getProperty("verify.out"));
            Files.createDirectories(out);
            Files.writeString(out.resolve("mysql-evidence.json"),
                    new ObjectMapper().writerWithDefaultPrettyPrinter().writeValueAsString(evidence));
            Files.copy(temporary.resolve("driver.json.results"), out.resolve("driver-results.json"),
                    java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            Files.copy(log, out.resolve("driver.log"), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            System.out.println("VERIFY13304_EVIDENCE " + out);
        }
    }
}
