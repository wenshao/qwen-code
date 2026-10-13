import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.apache.rocketmq.client.apis.*;
import org.apache.rocketmq.client.apis.consumer.*;
import org.apache.rocketmq.client.apis.message.MessageView;

/** Subscribes LiteTopics listed (one per line) in a control file, appends every delivered message as JSONL. */
public class JournalConsumer {
    public static void main(String[] a) throws Exception {
        String endpoint = a[0], topic = a[1], group = a[2];
        Path out = Paths.get(a[3]), control = Paths.get(a[4]);
        ClientServiceProvider p = ClientServiceProvider.loadService();
        ClientConfiguration cfg = ClientConfiguration.newBuilder().setEndpoints(endpoint).build();
        Object lock = new Object();
        LitePushConsumer c = p.newLitePushConsumerBuilder().setClientConfiguration(cfg)
            .setConsumerGroup(group).bindTopic(topic)
            .setMessageListener((MessageView m) -> {
                java.nio.ByteBuffer b = m.getBody(); byte[] bytes = new byte[b.remaining()]; b.get(bytes);
                String body = new String(bytes, StandardCharsets.UTF_8);
                String line = "{\"recvAt\":" + System.currentTimeMillis()
                    + ",\"topic\":" + q(m.getTopic())
                    + ",\"liteTopic\":" + q(m.getLiteTopic().orElse(""))
                    + ",\"keys\":" + q(String.join(",", m.getKeys()))
                    + ",\"messageId\":" + q(m.getMessageId().toString())
                    + ",\"bornTimestamp\":" + m.getBornTimestamp()
                    + ",\"deliveryAttempt\":" + m.getDeliveryAttempt()
                    + ",\"body\":" + q(body) + "}\n";
                synchronized (lock) {
                    try { Files.writeString(out, line, StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND); }
                    catch (IOException e) { throw new UncheckedIOException(e); }
                }
                return ConsumeResult.SUCCESS;
            }).build();
        Set<String> subscribed = new HashSet<>();
        System.out.println("READY"); System.out.flush();
        while (true) {
            if (Files.exists(control)) {
                for (String s : Files.readAllLines(control)) {
                    s = s.trim();
                    if (s.isEmpty() || subscribed.contains(s)) continue;
                    try { c.subscribeLite(s); subscribed.add(s); System.out.println("SUBSCRIBED " + s + " at " + System.currentTimeMillis()); }
                    catch (Exception e) { System.out.println("SUBSCRIBE-FAILED " + s + " " + e); subscribed.add(s); }
                    System.out.flush();
                }
            }
            Thread.sleep(100);
        }
    }
    static String q(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char ch : s.toCharArray()) {
            if (ch == '"' || ch == '\\') b.append('\\').append(ch);
            else if (ch < 0x20) b.append(String.format("\\u%04x", (int) ch));
            else b.append(ch);
        }
        return b.append('"').toString();
    }
}
