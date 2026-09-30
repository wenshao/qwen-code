import java.nio.file.*;
import java.nio.file.attribute.*;
public class Btime {
    public static void main(String[] a) throws Exception {
        for (String s : a) {
            Path p = Path.of(s);
            BasicFileAttributes b = Files.readAttributes(p, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
            System.out.println(s + ": creationTime=" + b.creationTime().toMillis() + " lastModified=" + b.lastModifiedTime().toMillis()
                + " unix:ino=" + Files.getAttribute(p, "unix:ino", LinkOption.NOFOLLOW_LINKS));
        }
    }
}
