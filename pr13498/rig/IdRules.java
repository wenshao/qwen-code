import java.lang.reflect.Method;
import java.nio.file.*;
import java.util.*;
// Feeds each (tenantId, workspaceId, sessionId) triple to the shipped
// ManagedSessionStore.validateScope and prints accept/refuse + message.
public class IdRules {
    public static void main(String[] args) throws Exception {
        Class<?> store = Class.forName("com.alibaba.qwen.code.managedagent.store.ManagedSessionStore");
        Method m = store.getDeclaredMethod("validateScope", String.class, String.class, String.class);
        m.setAccessible(true);
        for (String line : Files.readAllLines(Path.of(args[0]))) {
            String[] f = line.split("\t", -1);
            String t = unescape(f[1]), w = unescape(f[2]), s = unescape(f[3]);
            String verdict;
            try { m.invoke(null, t, w, s); verdict = "accept"; }
            catch (java.lang.reflect.InvocationTargetException e) { verdict = "refuse: " + e.getCause().getMessage(); }
            System.out.println(f[0] + "\t" + verdict);
        }
    }
    static String unescape(String v) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < v.length(); i++) {
            if (v.charAt(i) == '\\' && i + 5 < v.length() + 0 && v.charAt(i + 1) == 'u') {
                b.append((char) Integer.parseInt(v.substring(i + 2, i + 6), 16)); i += 5;
            } else b.append(v.charAt(i));
        }
        return b.toString();
    }
}
