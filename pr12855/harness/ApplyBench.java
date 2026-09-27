import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.function.Function;

/** Times the PR's ManagedExtensionRecordStore.apply on journal bytes that carry no Stage H record. */
public class ApplyBench {
    static String line(int payloadBytes, int seq) {
        String pad = "x".repeat(Math.max(0, payloadBytes));
        return "{\"type\":\"system\",\"subtype\":\"managed_session_event_v1\",\"uuid\":\"u" + seq
                + "\",\"managedSession\":{\"v\":1,\"sequence\":" + seq + ",\"eventId\":\"e" + seq
                + "\",\"kind\":\"tool.result\",\"occurredAt\":1790000000000,\"payload\":{\"text\":\"" + pad + "\"}}}";
    }
    static byte[] tx(int lines, int payload) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < lines; i++) b.append(line(payload, i + 1)).append('\n');
        b.append("{\"type\":\"system\",\"subtype\":\"managed_session_commit_v1\",\"commit\":{\"n\":1}}\n");
        return b.toString().getBytes(StandardCharsets.UTF_8);
    }
    public static void main(String[] args) throws Exception {
        Class<?> c = Class.forName("com.alibaba.qwen.code.managedagent.store.ManagedExtensionRecordStore");
        Constructor<?> k = c.getDeclaredConstructor(org.springframework.jdbc.core.JdbcTemplate.class);
        k.setAccessible(true);
        Object store = k.newInstance((Object) null);
        Method apply = c.getDeclaredMethod("apply", String.class, String.class, String.class, byte[].class, Function.class);
        apply.setAccessible(true);
        Object[][] cases = {
            {"typical: 1 event + marker, ~1.5 KB", tx(1, 1200)},
            {"64 KiB tool result: 1 event + marker", tx(1, 64 * 1024)},
            {"1 MiB line (the per-line cap) + marker", tx(1, 1024 * 1024 - 400)},
            {"8 MiB transaction (the cap): 256 x 32 KiB lines", tx(256, 32 * 1024 - 400)},
        };
        for (Object[] cs : cases) {
            byte[] bytes = (byte[]) cs[1];
            for (int i = 0; i < 200; i++) apply.invoke(store, "t", "w", "s", bytes, null); // warm up
            int n = bytes.length > 1_000_000 ? 50 : 2000;
            long t0 = System.nanoTime();
            for (int i = 0; i < n; i++) apply.invoke(store, "t", "w", "s", bytes, null);
            double us = (System.nanoTime() - t0) / 1e3 / n;
            System.out.printf("%-48s %9d bytes  %10.1f us/commit%n", cs[0], bytes.length, us);
        }
    }
}
