import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;

/** Deterministic replay of the race: open /proc/<pid>/stat, let the child be killed and reaped, then read. */
public class EsrchDemo {
    public static void main(String[] args) throws Exception {
        Process child = new ProcessBuilder("/bin/sleep", "120").start();
        Path stat = Path.of("/proc", Long.toString(child.pid()), "stat");
        System.out.println("child pid=" + child.pid() + " stat exists=" + Files.exists(stat));
        try (FileChannel channel = FileChannel.open(stat)) {
            child.destroyForcibly();
            child.waitFor(); // the JVM's process reaper has now waitpid()ed the zombie
            System.out.println("after SIGKILL+reap: isAlive=" + child.toHandle().isAlive()
                    + " stat exists=" + Files.exists(stat));
            channel.read(ByteBuffer.allocate(4096));
            System.out.println("read succeeded (no race)");
        } catch (Exception error) {
            System.out.println("read threw " + error);
            System.out.println("instanceof NoSuchFileException = " + (error instanceof NoSuchFileException));
            for (StackTraceElement frame : error.getStackTrace()) {
                if (frame.getClassName().startsWith("sun.nio.ch")) {
                    System.out.println("    at " + frame);
                }
            }
        }
    }
}
