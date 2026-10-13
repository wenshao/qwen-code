package com.alibaba.qwen.code.managedagent;

import static org.mockito.Mockito.CALLS_REAL_METHODS;
import static org.mockito.Mockito.mock;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * Rig-only harness (not part of the PR): drives the real HostedOperatorRecoveryProbe.close() with one
 * escaped writer whose cwd matches the session directory. A JDI driver (CwdKill) may SIGKILL that writer
 * after running() said "running" and before readSymbolicLink(/proc/pid/cwd) executes.
 */
@EnabledOnOs(OS.LINUX)
class CwdRaceTest {
    @Test
    void escapedWriterDiesBeforeCwdRead() throws Exception {
        String arm = System.getProperty("stress.arm", "?");
        long iterations = Long.getLong("stress.iterations", 50);
        Path pidFile = Path.of(System.getProperty("cwd.pidfile", "/rig/cwd-target.pid"));
        Map<String, Long> counts = new LinkedHashMap<>();
        Map<String, String> samples = new LinkedHashMap<>();
        for (long i = 1; i <= iterations; i++) {
            Path dir = Files.createTempDirectory("cwd-race-");
            Path expected = Files.createDirectory(dir.resolve("expected"));
            boolean zombie = Boolean.getBoolean("cwd.zombie");
            // zombie mode: the escaped writer is a grandchild whose parent never waits, so once killed it stays
            // a zombie (not reaped by this JVM), like a detached writer outside the JVM's process tree.
            Process writer = zombie
                    ? new ProcessBuilder("/bin/sh", "-c", "sleep 120 & echo $! > writer.pid; exec sleep 300")
                            .directory(expected.toFile()).start()
                    : new ProcessBuilder("/bin/sleep", "120").directory(expected.toFile()).start();
            long target = writer.pid();
            if (zombie) {
                Path written = expected.resolve("writer.pid");
                while (!Files.exists(written) || Files.readString(written).isBlank()) {
                    Thread.sleep(5);
                }
                target = Long.parseLong(Files.readString(written).strip());
            }
            String outcome;
            try {
                Files.writeString(expected.resolve("escaped.pid"), Long.toString(target));
                Files.writeString(pidFile, Long.toString(target));
                var probe = mock(HostedOperatorRecoveryProbe.class, CALLS_REAL_METHODS);
                ReflectionTestUtils.setField(probe, "sessions", List.of(
                        Map.of("sessionId", "cwd-race", "directory", expected.toString())));
                ReflectionTestUtils.setField(probe, "processes", new LinkedHashSet<ProcessHandle>());
                ReflectionTestUtils.setField(probe, "escapedProcesses", new HashMap<String, ProcessHandle>());
                ReflectionTestUtils.setField(probe, "local", new Local(Map.of()));
                try {
                    probe.close();
                    outcome = "closed";
                } catch (Throwable error) {
                    outcome = "escaped:" + error.getClass().getSimpleName();
                    samples.putIfAbsent(outcome, "iteration=" + i + " -> " + error);
                }
            } finally {
                ProcessHandle.of(target).ifPresent(ProcessHandle::destroyForcibly);
                writer.destroyForcibly();
                writer.waitFor(30, TimeUnit.SECONDS);
                try (var walk = Files.walk(dir)) {
                    walk.sorted(java.util.Comparator.reverseOrder()).forEach(path -> path.toFile().delete());
                }
            }
            counts.merge(outcome, 1L, Long::sum);
        }
        System.out.println("CWDRESULT arm=" + arm + " iterations=" + iterations + " " + counts);
        samples.forEach((key, value) -> System.out.println("CWDSAMPLE " + key + " " + value));
    }

    private record Registration(ProcessHandle process) { }

    private record Owned(Registration registration) { }

    private record Local(Map<String, Owned> owned) { }
}
