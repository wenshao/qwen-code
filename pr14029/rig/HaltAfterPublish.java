import com.alibaba.qwen.code.managedagent.service.LiteTopicEventTransport;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import org.apache.rocketmq.client.apis.*;
import org.apache.rocketmq.client.apis.producer.Producer;

/** publishCommitted() M records (template session id replaced) then close() immediately, as Spring's destroy does. */
public class HaltAfterPublish {
    public static void main(String[] a) throws Exception {
        String endpoint = a[0], topic = a[1];
        String template = Files.readString(Paths.get(a[2]), StandardCharsets.UTF_8);
        String fromSession = a[3], toSession = a[4]; int m = Integer.parseInt(a[5]); long sleepBeforeCloseMs = Long.parseLong(a[6]);
        byte[] record = template.replace(fromSession, toSession).getBytes(StandardCharsets.UTF_8);
        ClientServiceProvider p = ClientServiceProvider.loadService();
        Producer producer = p.newProducerBuilder().setClientConfiguration(
                ClientConfiguration.newBuilder().setEndpoints(endpoint).build()).setTopics(topic).build();
        LiteTopicEventTransport t = new LiteTopicEventTransport(producer, p, topic);
        long t0 = System.nanoTime();
        for (int i = 0; i < m; i++) t.publishCommitted(record);
        long t1 = System.nanoTime();
        if (sleepBeforeCloseMs > 0) Thread.sleep(sleepBeforeCloseMs);
        Runtime.getRuntime().halt(0);
        long t2 = System.nanoTime();
        System.out.printf("published %d records in %.1f ms; close() took %.1f ms%n", m, (t1 - t0) / 1e6, (t2 - t1) / 1e6 - sleepBeforeCloseMs);
        System.exit(0);
    }
}
