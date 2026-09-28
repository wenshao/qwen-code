import com.alibaba.qwen.code.managedagent.ManagedAgentServerApplication;
import com.alibaba.qwen.code.managedagent.api.AuthenticatedTenantActor;
import com.alibaba.qwen.code.managedagent.api.WorkspaceSelection;
import com.alibaba.qwen.code.managedagent.service.EmbeddedRuntimeBroker;
import com.alibaba.qwen.code.managedagent.store.ManagedAgentStore;
import com.alibaba.qwen.code.runtimebroker.WorkspaceExecutionProfile;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import jakarta.servlet.Filter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.Principal;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Long-running rig for PR 12946: Spring + session store + embedded Broker on fixed
 * ports, N Workspaces, an admin endpoint to create Sessions and run SQL.
 */
public class RigMain {
    @Configuration
    public static class RigActorConfig {
        @Bean
        public FilterRegistrationBean<Filter> rigActor() {
            FilterRegistrationBean<Filter> bean = new FilterRegistrationBean<>((request, response, chain) -> {
                HttpServletRequest http = (HttpServletRequest) request;
                String actor = http.getHeader("X-Rig-Actor");
                String tenant = http.getHeader("X-Qwen-Tenant-Id");
                if (actor == null || tenant == null) {
                    chain.doFilter(request, response);
                    return;
                }
                Principal principal = new RigPrincipal(tenant, actor);
                chain.doFilter(new HttpServletRequestWrapper(http) {
                    @Override
                    public Principal getUserPrincipal() {
                        return principal;
                    }
                }, response);
            });
            bean.setOrder(Ordered.HIGHEST_PRECEDENCE);
            return bean;
        }
    }

    record RigPrincipal(String tenantId, String actorId) implements AuthenticatedTenantActor {
        @Override
        public String getName() {
            return actorId;
        }
    }

    public static void main(String[] args) throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        String tenant = System.getProperty("rig.tenant", "t-rig");
        int workspaces = Integer.getInteger("rig.workspaces", 4);
        Path root = Path.of(System.getProperty("rig.root")).toAbsolutePath();
        Files.createDirectories(root.resolve("runtime"));
        String node = System.getProperty("rig.node");
        String cli = System.getProperty("rig.cli");
        String db = System.getProperty("rig.db");
        boolean mysql = db.startsWith("jdbc:mysql:") || db.startsWith("jdbc:mariadb:");
        var arguments = new ArrayList<>(List.of(
                "--server.address=127.0.0.1", "--server.port=" + System.getProperty("rig.port", "18946"),
                "--spring.datasource.url=" + db,
                "--spring.datasource.driver-class-name=" + (mysql ? "com.mysql.cj.jdbc.Driver" : "org.h2.Driver"),
                "--spring.datasource.username=" + System.getProperty("rig.user", "root"),
                "--spring.datasource.password=" + System.getProperty("rig.password", "rig12946"),
                "--qwen.managed-agent.session-store.enabled=true",
                "--qwen.managed-agent.harness.enabled=false",
                "--qwen.managed-agent.harness.capability-digest=sha256:" + "a".repeat(64),
                "--qwen.managed-agent.runtime-broker.enabled=true",
                "--qwen.managed-agent.runtime-broker.port=" + System.getProperty("rig.brokerPort", "19946"),
                "--qwen.managed-agent.runtime-broker.token=hosted-tools-broker-token",
                "--qwen.managed-agent.runtime-broker.workspace-cwd=" + root,
                "--qwen.managed-agent.runtime-broker.state-directory=" + root.resolve("runtime"),
                "--qwen.managed-agent.runtime-broker.credential-key-id=test",
                "--qwen.managed-agent.runtime-broker.credential-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                "--qwen.managed-agent.runtime-broker.node-executable=" + node,
                "--qwen.managed-agent.runtime-broker.worker-entry=" + cli,
                "--qwen.managed-agent.runtime-broker.cli-entry=" + cli));
        List<Path> roots = new ArrayList<>();
        for (int index = 0; index < workspaces; index++) {
            Path ws = root.resolve("ws-" + index);
            Files.createDirectories(ws.resolve("child"));
            roots.add(ws);
            String prefix = "--qwen.managed-agent.runtime-broker.workspace-mounts[" + index + "].";
            arguments.add(prefix + "tenant-id=" + tenant);
            arguments.add(prefix + "storage-id=storage-" + index);
            arguments.add(prefix + "root=" + ws);
        }
        var spring = (ServletWebServerApplicationContext) new SpringApplicationBuilder(
                ManagedAgentServerApplication.class, RigActorConfig.class).run(arguments.toArray(String[]::new));
        JdbcTemplate jdbc = spring.getBean(JdbcTemplate.class);
        ManagedAgentStore store = spring.getBean(ManagedAgentStore.class);
        EmbeddedRuntimeBroker broker = spring.getBean(EmbeddedRuntimeBroker.class);
        for (int index = 0; index < workspaces; index++) {
            String workspaceId = "workspace-" + index;
            jdbc.update("INSERT INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation,"
                    + " storage_id, display_name, config_ref, policy_ref, state) VALUES (?, ?, 1, ?,"
                    + " 'Workspace', ?, ?, 'ACTIVE')", tenant, workspaceId, "storage-" + index,
                    WorkspaceExecutionProfile.CONFIG_REF, WorkspaceExecutionProfile.POLICY_REF);
            jdbc.update("INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create)"
                    + " VALUES (?, ?, ?, TRUE, TRUE)", tenant, workspaceId, "actor".getBytes(StandardCharsets.UTF_8));
        }
        AtomicInteger counter = new AtomicInteger();
        HttpServer admin = HttpServer.create(new InetSocketAddress("127.0.0.1",
                Integer.getInteger("rig.adminPort", 17946)), 0);
        admin.createContext("/session", exchange -> handle(exchange, mapper, body -> {
            int index = ((Number) body.get("workspace")).intValue();
            var created = store.insertWorkspaceSessionCommand(tenant, "actor", "create-" + counter.incrementAndGet()
                    + "-" + System.nanoTime(), "sha256:" + "a".repeat(64), "qwen-code", null, null, List.of(), null,
                    new WorkspaceSelection("workspace-" + index, "child"));
            return Map.of("sessionId", created.sessionId(), "workspaceId", "workspace-" + index,
                    "directory", roots.get(index).resolve("child").toString());
        }));
        admin.createContext("/sql/update", exchange -> handle(exchange, mapper, body -> Map.of("count",
                jdbc.update(body.get("sql").toString(), ((List<?>) body.getOrDefault("args", List.of())).toArray()))));
        admin.createContext("/sql/query", exchange -> handle(exchange, mapper, body -> {
            List<Map<String, Object>> rows = jdbc.queryForList(body.get("sql").toString(),
                    ((List<?>) body.getOrDefault("args", List.of())).toArray());
            List<Map<String, Object>> out = new ArrayList<>();
            for (Map<String, Object> row : rows) {
                Map<String, Object> copy = new LinkedHashMap<>();
                row.forEach((key, value) -> copy.put(key, value instanceof byte[] bytes
                        ? new String(bytes, StandardCharsets.UTF_8) : value == null ? null : value.toString()));
                out.add(copy);
            }
            return Map.of("rows", out);
        }));
        admin.start();
        Map<String, Object> info = new LinkedHashMap<>();
        info.put("tenantId", tenant);
        info.put("storeUrl", "http://127.0.0.1:" + spring.getWebServer().getPort());
        info.put("brokerUrl", broker.getBaseUri().toString());
        info.put("adminUrl", "http://127.0.0.1:" + admin.getAddress().getPort());
        info.put("root", root.toString());
        mapper.writeValue(root.resolve("rig.json").toFile(), info);
        System.out.println("RIG_READY " + mapper.writeValueAsString(info));
        CountDownLatch stop = new CountDownLatch(1);
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            admin.stop(0);
            spring.close();
            stop.countDown();
        }));
        stop.await();
    }

    interface Body {
        Object apply(Map<String, Object> body) throws Exception;
    }

    @SuppressWarnings("unchecked")
    private static void handle(HttpExchange exchange, ObjectMapper mapper, Body body) {
        try (exchange) {
            byte[] out;
            int status = 200;
            try {
                Map<String, Object> input = mapper.readValue(exchange.getRequestBody(), Map.class);
                out = mapper.writeValueAsBytes(body.apply(input));
            } catch (Exception error) {
                status = 500;
                out = mapper.writeValueAsBytes(Map.of("error", String.valueOf(error)));
            }
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, out.length);
            exchange.getResponseBody().write(out);
        } catch (Exception ignored) {
        }
    }
}
