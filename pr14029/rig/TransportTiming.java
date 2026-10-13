import com.alibaba.qwen.code.managedagent.service.LiteTopicEventTransport;
import java.nio.file.*;
import java.util.*;
import org.apache.rocketmq.client.apis.*;
import org.apache.rocketmq.client.apis.producer.Producer;

/** Times publishCommitted() on the calling (committing) thread across broker states. */
public class TransportTiming {
    public static void main(String[] a) throws Exception {
        String endpoint = a[0], topic = a[1]; byte[] record = Files.readAllBytes(Paths.get(a[2]));
        int n = Integer.parseInt(a[3]); Path ctl = Paths.get(a[4]); String[] phases = a[5].split(",");
        ClientServiceProvider p = ClientServiceProvider.loadService();
        Producer producer = p.newProducerBuilder().setClientConfiguration(
                ClientConfiguration.newBuilder().setEndpoints(endpoint).build()).setTopics(topic).build();
        LiteTopicEventTransport t = new LiteTopicEventTransport(producer, p, topic);
        for (int i = 0; i < 50; i++) t.publishCommitted(record); // warm-up
        Thread.sleep(2000);
        for (String phase : phases) {
            Path go = ctl.resolve("go-" + phase);
            System.out.println("WAITING " + phase); System.out.flush();
            while (!Files.exists(go)) Thread.sleep(100);
            long[] d = new long[n];
            long wall0 = System.nanoTime();
            for (int i = 0; i < n; i++) { long t0 = System.nanoTime(); t.publishCommitted(record); d[i] = System.nanoTime() - t0; Thread.sleep(20); }
            long wall = System.nanoTime() - wall0;
            Arrays.sort(d);
            System.out.printf("PHASE %s n=%d p50_us=%.1f p90_us=%.1f p99_us=%.1f max_us=%.1f wall_ms=%d%n", phase, n,
                d[n / 2] / 1e3, d[(int) (n * 0.9)] / 1e3, d[(int) (n * 0.99)] / 1e3, d[n - 1] / 1e3, wall / 1_000_000);
            System.out.flush();
            Files.writeString(ctl.resolve("done-" + phase), "ok");
        }
        System.exit(0);
    }
}
