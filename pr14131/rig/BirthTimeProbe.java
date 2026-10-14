package com.alibaba.qwen.code.managedagent.store;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.util.Map;

// Replays the Hosted fixtures' root setup on the real filesystem and feeds the
// attributes to the production WorkspaceStorageGuard.verifiedBirthTime check.
//   shape "flat":   createDirectory(root); createDirectory(root/child)          (PublicWorkspace, TeamLead)
//   shape "nested": createDirectories(root/workspace/child), check root/workspace (ProcessCrash, ShellLifecycle)
public class BirthTimeProbe {
    public static void main(String[] args) throws Exception {
        int n = Integer.parseInt(args[0]);
        Path base = Files.createTempDirectory("btprobe");
        System.out.printf("probe fs=%s jdk=%s n=%d%n", Files.getFileStore(base).type(),
                System.getProperty("java.version"), n);
        for (String shape : new String[] {"flat", "nested"}) {
            for (boolean pin : new boolean[] {false, true}) {
                int refused = 0;
                String sample = null;
                for (int i = 0; i < n; i++) {
                    Path dir = base.resolve(shape + (pin ? "-pin-" : "-raw-") + i);
                    Path root;
                    if (shape.equals("flat")) {
                        root = Files.createDirectory(dir);
                        Files.createDirectory(root.resolve("child"));
                    } else {
                        Files.createDirectory(dir);
                        Files.createDirectories(dir.resolve("workspace/child"));
                        root = dir.resolve("workspace");
                    }
                    if (pin) Files.setLastModifiedTime(root, FileTime.fromMillis(1));
                    Map<String, Object> a = Files.readAttributes(root,
                            "unix:creationTime,lastModifiedTime", LinkOption.NOFOLLOW_LINKS);
                    FileTime c = (FileTime) a.get("creationTime");
                    FileTime m = (FileTime) a.get("lastModifiedTime");
                    String verdict;
                    try {
                        verdict = "accepted birth=" + WorkspaceStorageGuard.verifiedBirthTime(c, m);
                    } catch (IOException e) {
                        refused++;
                        verdict = "REFUSED: " + e.getMessage();
                    }
                    if (sample == null) sample = "creationTime=" + c + " lastModifiedTime=" + m + " -> " + verdict;
                }
                System.out.printf("RESULT shape=%-6s pin=%-5s refused=%d/%d  e.g. %s%n", shape, pin, refused, n, sample);
            }
        }
    }
}
