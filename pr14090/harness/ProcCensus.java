import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * Rig-only census: SIGKILL a real child (reaped by the JVM's own reaper thread, as in the fixture) and keep
 * reading /proc/<pid>/stat or /proc/<pid>/cwd in a tight loop through exit, zombie and reap. Counts, per kill,
 * which exception flavours appeared at least once. Shows which errno flavours a dying process can produce.
 */
public class ProcCensus {
    public static void main(String[] args) throws Exception {
        String kind = args[0];
        long seconds = Long.parseLong(args[1]);
        Map<String, Long> killsWith = new TreeMap<>();
        long kills = 0;
        long reads = 0;
        long end = System.nanoTime() + seconds * 1_000_000_000L;
        while (System.nanoTime() < end) {
            kills++;
            Process child = new ProcessBuilder("/bin/sleep", "60").start();
            Path proc = Path.of("/proc", Long.toString(child.pid()));
            Path target = proc.resolve(kind);
            Set<String> flavours = new TreeSet<>();
            child.destroyForcibly();
            long guard = System.nanoTime() + 5_000_000_000L;
            while (Files.exists(proc) && System.nanoTime() < guard) {
                reads++;
                try {
                    if (kind.equals("stat")) {
                        Files.readString(target);
                    } else {
                        Files.readSymbolicLink(target);
                    }
                } catch (IOException error) {
                    flavours.add(error.getClass().getSimpleName() + "(" + error.getMessage().replace(target.toString(), "<path>")
                            .replace("<path>: ", "") + ")");
                }
            }
            child.waitFor();
            for (String flavour : flavours) {
                killsWith.merge(flavour, 1L, Long::sum);
            }
        }
        System.out.println("CENSUS kind=" + kind + " kills=" + kills + " reads=" + reads + " killsWith=" + killsWith);
    }
}
