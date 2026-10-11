// VERIFICATION RIG ONLY (PR #13673 round 4): emulate "a concurrent operation holding the per-path lock" between the
// two reconciles of the hook-detach escalation (review R2-2). Waits until the original registration is RETIRED (the
// first reconcile writes that under the LocalRuntimeStore file lock), then takes the same fcntl lock at the first
// moment the Broker releases it, holds it for holdMs, and releases it. One JSON object per line on stdout.
// usage: java -cp <dir> LockGrab <lockPath> <registrationJson> <holdMs> <maxWaitMs>
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

public final class LockGrab {
    private static long t0 = System.currentTimeMillis();

    private static void log(String json) {
        System.out.println("{\"epochMs\":" + System.currentTimeMillis() + "," + json + "}");
        System.out.flush();
    }

    public static void main(String[] args) throws Exception {
        Path lock = Path.of(args[0]);
        Path registration = Path.of(args[1]);
        long holdMs = Long.parseLong(args[2]);
        long maxWaitMs = Long.parseLong(args[3]);
        log("\"event\":\"started\"");
        long retiredAt = 0;
        while (retiredAt == 0) {
            if (System.currentTimeMillis() - t0 > maxWaitMs) {
                log("\"event\":\"gave-up\",\"reason\":\"registration never RETIRED\"");
                return;
            }
            try {
                String text = Files.readString(registration);
                if (text.matches("(?s).*\"state\"\\s*:\\s*\"RETIRED\".*")) {
                    retiredAt = System.currentTimeMillis();
                }
            } catch (Exception ignored) {
                // The store rewrites the file through a temporary file and rename.
            }
            if (retiredAt == 0) {
                Thread.onSpinWait();
            }
        }
        try (FileChannel channel = FileChannel.open(lock, StandardOpenOption.WRITE)) {
            long busy = 0;
            FileLock held = null;
            while (held == null) {
                held = channel.tryLock();
                if (held == null) {
                    busy++;
                    if (System.currentTimeMillis() - retiredAt > maxWaitMs) {
                        log("\"event\":\"gave-up\",\"reason\":\"lock never free\",\"busySpins\":" + busy);
                        return;
                    }
                    Thread.onSpinWait();
                }
            }
            long grabbed = System.currentTimeMillis();
            log("\"event\":\"grabbed\",\"retiredSeenEpochMs\":" + retiredAt + ",\"busySpinsBeforeGrab\":" + busy
                    + ",\"msAfterRetiredSeen\":" + (grabbed - retiredAt));
            Thread.sleep(holdMs);
            held.release();
            log("\"event\":\"released\",\"heldMs\":" + (System.currentTimeMillis() - grabbed));
        }
    }
}
