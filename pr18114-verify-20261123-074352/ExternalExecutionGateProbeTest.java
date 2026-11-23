package com.alibaba.qwen.code.runtimebroker.probing;

import com.alibaba.qwen.code.managedagent.config.ManagedAgentProperties;
import com.alibaba.qwen.code.runtimebroker.ManagedExtensionExecutionProfile;
import com.alibaba.qwen.code.runtimebroker.RuntimeProvisionRequest;
import com.alibaba.qwen.code.runtimebroker.RuntimeScope;
import com.alibaba.qwen.code.runtimebroker.adapter.HttpRuntimeTransport;
import com.alibaba.qwen.code.runtimebroker.provisioning.external.ExternalRuntimeProviderFactory;
import com.alibaba.qwen.code.runtimebroker.provisioning.external.ExternalWorkspaceProvisioner;
import com.alibaba.qwen.code.runtimebroker.spi.ExternalStorageRegistry;
import com.alibaba.qwen.code.runtimebroker.spi.RuntimeProviderDependencies;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Duration;
import java.util.Optional;

/**
 * Scratch probe (not part of the PR): records the external execution
 * admission cells to a file so both arms can be compared row by row.
 */
class ExternalExecutionGateProbeTest {
    private static final Path OUT = Path.of(
            System.getProperty("probe.out", "/tmp/external-gate-probe.txt"));

    private static void rec(String key, Object value) {
        String line = "PROBE " + key + " = " + value + System.lineSeparator();
        try {
            Files.writeString(OUT, line, StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String describe(Throwable t) {
        Throwable cause = t instanceof java.lang.reflect.InvocationTargetException ite ? ite.getCause() : t;
        if (cause == null) cause = t;
        String message = String.valueOf(cause.getMessage());
        return cause.getClass().getSimpleName() + ": " + message;
    }

    private static ManagedAgentProperties configured(String cacheDirectory) {
        ManagedAgentProperties settings = new ManagedAgentProperties();
        settings.getRuntimeBroker().setEnabled(true);
        settings.getRuntimeBroker().setProvisioner("external-workspace");
        settings.getRuntimeBroker().setIsolationClass("session");
        settings.getRuntimeBroker().setBoundSessionIsolationClass("session");
        settings.getRuntimeBroker().setExternalProviderUrl("http://127.0.0.1:1");
        settings.getRuntimeBroker().setExternalProviderToken("probe-token-0123456789");
        settings.getRuntimeBroker().setExternalProviderId("provider-a");
        settings.getRuntimeBroker().setWorkspaceId("workspace-a");
        settings.getRuntimeBroker().setWorkspaceCwd("/workspace/storage");
        settings.getRuntimeBroker().setTrustedLocalRebootRecovery(false);
        settings.getHarness().setEnabled(true);
        settings.getHarness().setWorkspaceFilesEnabled(true);
        settings.getHarness().setWorkspaceShellEnabled(true);
        settings.getSessionStore().setEnabled(true);
        settings.getManagedExtensions().setEnabled(true);
        settings.getManagedExtensions().setMode("developer-process-group");
        settings.getManagedExtensions().setCacheDirectory(cacheDirectory);
        settings.getExtensions().setEnabled(true);
        settings.getToolPublication().setEnabled(true);
        return settings;
    }

    private static final class UnusedClient
            implements com.alibaba.qwen.code.runtimebroker.spi.ExternalRuntimeClient {
        private static <T> java.util.concurrent.CompletionStage<T> fail() {
            return java.util.concurrent.CompletableFuture.failedFuture(
                    new IllegalStateException("probe client is not called"));
        }

        @Override
        public java.util.concurrent.CompletionStage<java.util.Map<String, Object>> provision(
                java.util.Map<String, Object> request) {
            return fail();
        }

        @Override
        public java.util.concurrent.CompletionStage<java.util.Map<String, Object>> observe(
                java.util.Map<String, Object> request) {
            return fail();
        }

        @Override
        public java.util.concurrent.CompletionStage<java.util.Map<String, Object>> reattach(
                java.util.Map<String, Object> request) {
            return fail();
        }
    }

    @Test
    void admissionCells() {
        for (String cache : new String[] {"", "relative/cache", "/var/cache/qwen-extensions"}) {
            String label = "[" + cache + "]";
            ManagedAgentProperties settings = configured(cache);
            try {
                Method gate = ManagedAgentProperties.class
                        .getMethod("isExternalWorkspaceExecutionConfigured");
                rec("gate." + label, gate.invoke(settings));
            } catch (NoSuchMethodException absent) {
                rec("gate." + label, "absent");
            } catch (Throwable failure) {
                rec("gate." + label, "error " + describe(failure));
            }
            ExternalRuntimeProviderFactory factory = new ExternalRuntimeProviderFactory();
            try {
                factory.validate(settings);
                rec("validate." + label, "accepted");
            } catch (Throwable failure) {
                rec("validate." + label, describe(failure));
            }
            try {
                factory.create(settings, new HttpRuntimeTransport(), RuntimeProviderDependencies.NONE);
                rec("create." + label, "created");
            } catch (Throwable failure) {
                rec("create." + label, describe(failure));
            }
        }

        ExternalStorageRegistry registry = (tenant, alias) -> Optional.of(
                new ExternalStorageRegistry.RegisteredExternalStorage(
                        "provider-a", "physical-a", 1L, "workspace-a",
                        "/external/workspace-a", "/workspace/storage"));
        ExternalWorkspaceProvisioner provisioner = new ExternalWorkspaceProvisioner(
                new UnusedClient(), registry, "provider-a", Duration.ofSeconds(5));
        RuntimeScope developerScope = new RuntimeScope("tenant-a", "workspace-a", "1",
                "/workspace/storage",
                ManagedExtensionExecutionProfile.DEVELOPER_CAPABILITY_DIGEST, "session");
        RuntimeProvisionRequest request = provisioner.createRequest(developerScope, "isolation-a");
        rec("createRequest.developer.isManagedContext", request.isManagedContext());
        rec("createRequest.developer.storageId", request.getStorageId());

        for (String cache : new String[] {"", "relative/cache"}) {
            try {
                new HttpRuntimeTransport().withManagedExtensionCacheDirectory(cache, null);
                rec("transport.cache[" + cache + "]", "accepted");
            } catch (Throwable failure) {
                rec("transport.cache[" + cache + "]", describe(failure));
            }
        }

        try {
            Constructor<ExternalWorkspaceProvisioner> ctor = ExternalWorkspaceProvisioner.class
                    .getConstructor(
                            com.alibaba.qwen.code.runtimebroker.spi.ExternalRuntimeClient.class,
                            ExternalStorageRegistry.class, String.class, Duration.class, String.class);
            try {
                ctor.newInstance(new UnusedClient(), registry, "provider-a",
                        Duration.ofSeconds(5), "");
                rec("provisionerCtor.blank", "accepted");
            } catch (Throwable failure) {
                rec("provisionerCtor.blank", describe(failure));
            }
        } catch (NoSuchMethodException absent) {
            rec("provisionerCtor.blank", "absent (4-arg only)");
        }
    }
}
