package com.alibaba.qwen.code.managedagent;

import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;

/**
 * Rig-only harness (not part of the PR): runs the unchanged body of
 * HostedOperatorRecoveryProbeTest#cleansOwnedProcessesWhenAnEscapedPidFailsOwnershipValidation
 * repeatedly in one JVM and classifies every failure.
 */
@EnabledOnOs(OS.LINUX)
class ProbeRaceStressTest {
    @Test
    void stress() throws Exception {
        String arm = System.getProperty("stress.arm", "?");
        long seconds = Long.getLong("stress.seconds", 60);
        long maxIterations = Long.getLong("stress.iterations", Long.MAX_VALUE);
        Method body = HostedOperatorRecoveryProbeTest.class
                .getDeclaredMethod("cleansOwnedProcessesWhenAnEscapedPidFailsOwnershipValidation");
        body.setAccessible(true);
        Field temporary = HostedOperatorRecoveryProbeTest.class.getDeclaredField("temporary");
        temporary.setAccessible(true);
        var ctor = HostedOperatorRecoveryProbeTest.class.getDeclaredConstructor();
        ctor.setAccessible(true);

        org.assertj.core.api.Assertions.setMaxStackTraceElementsDisplayed(200);
        Map<String, Long> counts = new LinkedHashMap<>();
        Map<String, String> samples = new LinkedHashMap<>();
        long iterations = 0;
        long slowestFailMillis = 0;
        long end = System.nanoTime() + seconds * 1_000_000_000L;
        while (System.nanoTime() < end && iterations < maxIterations) {
            iterations++;
            Path dir = Files.createTempDirectory("probe-race-");
            var test = ctor.newInstance();
            temporary.set(test, dir);
            long started = System.nanoTime();
            String outcome;
            try {
                body.invoke(test);
                outcome = "pass";
            } catch (InvocationTargetException wrapped) {
                Throwable error = wrapped.getCause();
                String text = String.valueOf(error);
                if (text.contains("No such process")) {
                    outcome = "esrch";
                } else if (text.contains("stopped") || text.contains("Owned producer")) {
                    outcome = "timeout";
                } else {
                    outcome = "other";
                }
                long elapsed = (System.nanoTime() - started) / 1_000_000;
                slowestFailMillis = Math.max(slowestFailMillis, elapsed);
                if (!samples.containsKey(outcome)) {
                    StringBuilder frames = new StringBuilder();
                    for (String frame : text.split("\n")) {
                        if (frame.contains("managedagent.") || frame.contains("UnixFileDispatcherImpl.read0")
                                || frame.contains("Files.readString")) {
                            frames.append("\n    ").append(frame.strip());
                        }
                    }
                    String head = text.split("\n at |\n\tat ")[0].replace('\n', ' ').replaceAll("\\s+", " ");
                    samples.put(outcome, "iteration=" + iterations + " elapsedMs=" + elapsed + " -> " + head + frames);
                }
            } finally {
                try (var walk = Files.walk(dir)) {
                    walk.sorted(java.util.Comparator.reverseOrder()).forEach(path -> path.toFile().delete());
                }
            }
            counts.merge(outcome, 1L, Long::sum);
        }
        StringBuilder line = new StringBuilder("RESULT arm=" + arm + " iterations=" + iterations);
        for (String key : new String[] {"pass", "esrch", "timeout", "other"}) {
            line.append(' ').append(key).append('=').append(counts.getOrDefault(key, 0L));
        }
        line.append(" slowestFailMs=").append(slowestFailMillis);
        System.out.println(line);
        samples.forEach((key, value) -> System.out.println("SAMPLE " + key + " " + value));
    }
}
