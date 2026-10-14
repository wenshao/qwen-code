package com.alibaba.qwen.code.managedagent.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * PR #14178 verification probe (not part of the PR). Identical file in every arm. Real Git
 * maintenance runs against a real repository while the runner opens it in a loop.
 */
class Pr14178GitRaceProbeTest {
    @TempDir
    Path temp;

    @Test
    void objectsChurn() throws Exception {
        race("objects", Long.getLong("probe.seconds", 60));
    }

    @Test
    void objectsChurnDirectWalk() throws Exception {
        race("objects-direct", Long.getLong("probe.seconds", 60));
    }

    @Test
    void refsChurn() throws Exception {
        race("refs", Long.getLong("probe.seconds", 60));
    }

    private void race(String kind, long seconds) throws Exception {
        Path root = Files.createDirectory(temp.toRealPath().resolve("root"));
        Path project = Files.createDirectory(root.resolve("project"));
        git(project, "init", "-q", "-b", "main");
        git(project, "config", "gc.auto", "0");
        git(project, "config", "maintenance.auto", "false");
        Files.writeString(project.resolve("f.txt"), "f\n");
        git(project, "add", "-A");
        git(project, "commit", "-q", "-m", "init");
        String head = git(project, "rev-parse", "HEAD").trim();

        var stop = new AtomicBoolean();
        var cycles = new AtomicInteger();
        Thread churn = new Thread(() -> {
            int round = 0;
            try {
                while (!stop.get()) {
                    round++;
                    if (kind.startsWith("objects")) {
                        // Loose objects spread over many fan-out directories, then packed away:
                        // prune-packed removes the loose files and their now-empty directories.
                        var input = new StringBuilder();
                        for (int i = 0; i < 400; i++) {
                            input.append("r").append(round).append('-').append(i).append('\n');
                        }
                        Path list = temp.resolve("list.txt");
                        StringBuilder names = new StringBuilder();
                        for (int i = 0; i < 400; i++) {
                            Path blob = temp.resolve("b" + i);
                            Files.writeString(blob, "r" + round + "-" + i);
                            names.append(blob).append('\n');
                        }
                        Files.writeString(list, names);
                        git(project, "hash-object", "-w", "--stdin-paths", "<" + list);
                        git(project, "repack", "-d", "-q");
                        git(project, "prune-packed");
                    } else {
                        // Loose refs in nested directories, then packed: pack-refs --prune deletes
                        // the loose files and the emptied directories.
                        StringBuilder updates = new StringBuilder();
                        for (int i = 0; i < 300; i++) {
                            updates.append("create refs/heads/r").append(round % 7).append("/d").append(i % 30)
                                    .append("/b").append(i).append('-').append(round).append(' ').append(head)
                                    .append('\n');
                        }
                        Path list = temp.resolve("updates.txt");
                        Files.writeString(list, updates);
                        git(project, "update-ref", "--stdin", "<" + list);
                        git(project, "pack-refs", "--all", "--prune");
                        git(project, "for-each-ref", "--format=delete %(refname)", "refs/heads/r" + (round % 7),
                                ">" + list);
                        git(project, "update-ref", "--stdin", "<" + list);
                    }
                    cycles.incrementAndGet();
                }
            } catch (Exception error) {
                System.out.println("PROBE churn-error " + error);
            }
        }, "churn");

        var runner = new ChildWorktreeGit("git", Duration.ofSeconds(60));
        var walk = ChildWorktreeGit.class.getDeclaredMethod("requireNoLinks", Path.class, String.class, int.class);
        walk.setAccessible(true);
        Map<String, Integer> failures = new TreeMap<>();
        int opens = 0;
        int withCause = 0;
        String firstCause = "none";
        churn.start();
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds);
        try {
            while (System.nanoTime() < deadline) {
                opens++;
                try {
                    if (kind.equals("objects-direct")) {
                        try {
                            walk.invoke(null, project.resolve(".git"), "objects", 1);
                        } catch (java.lang.reflect.InvocationTargetException wrapped) {
                            throw (RuntimeException) wrapped.getCause();
                        }
                    } else {
                        runner.open(root, "project");
                    }
                } catch (ChildWorkspaceException error) {
                    failures.merge(error.getMessage(), 1, Integer::sum);
                    if (error.getCause() != null) {
                        withCause++;
                        if ("none".equals(firstCause)) {
                            firstCause = error.getCause().getClass().getSimpleName();
                        }
                    }
                }
            }
        } finally {
            stop.set(true);
            churn.join(120_000);
            runner.close();
        }
        int failed = failures.values().stream().mapToInt(Integer::intValue).sum();
        System.out.println("PROBE git kind=" + kind + " seconds=" + seconds + " opens=" + opens
                + " churnCycles=" + cycles.get() + " failures=" + failed + " withCause=" + withCause
                + " firstCause=" + firstCause + " messages=" + failures);
    }

    private static String git(Path directory, String... arguments) throws Exception {
        StringBuilder command = new StringBuilder("git");
        for (String argument : arguments) {
            if (argument.startsWith("<") || argument.startsWith(">")) {
                command.append(' ').append(argument.charAt(0)).append(" '").append(argument.substring(1)).append('\'');
            } else {
                command.append(" '").append(argument.replace("'", "'\\''")).append('\'');
            }
        }
        var process = new ProcessBuilder(List.of("/bin/sh", "-c", command.toString()))
                .directory(directory.toFile()).redirectErrorStream(true).start();
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        if (process.waitFor() != 0) {
            throw new IllegalStateException(command + ": " + output);
        }
        return output;
    }
}
