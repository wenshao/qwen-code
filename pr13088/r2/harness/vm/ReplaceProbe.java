import java.nio.file.*;
import java.nio.file.attribute.*;
// Replays the root replacement at the end of HostedWorkspaceStorageGuardMySqlIT (2cbf89313a, lines 85-89) and reports
// whether the new root's creation time equals its mtime (which WorkspaceStorageGuard treats as an unreadable identity).
public class ReplaceProbe {
    public static void main(String[] a) throws Exception {
        int equal = 0, n = Integer.parseInt(a[0]);
        for (int i = 0; i < n; i++) {
            Path t = Files.createTempDirectory(Path.of(a[1]), "rp");
            Path root = Files.createDirectory(t.resolve("root"));
            Files.createDirectory(root.resolve("child"));
            Files.writeString(root.resolve(".qwen-managed-storage.json"), "{}");
            Files.move(root, t.resolve("previous"));
            Files.createDirectory(root);
            Files.createDirectory(root.resolve("child"));
            Files.copy(t.resolve("previous/.qwen-managed-storage.json"), root.resolve(".qwen-managed-storage.json"));
            BasicFileAttributes b = Files.readAttributes(root, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
            if (b.creationTime().equals(b.lastModifiedTime())) equal++;
        }
        System.out.println("replacement roots whose creation time equals mtime: " + equal + " of " + n);
    }
}
