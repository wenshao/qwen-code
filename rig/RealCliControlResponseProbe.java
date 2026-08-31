import java.io.IOException;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;

import com.alibaba.qwen.code.cli.protocol.data.PermissionMode;
import com.alibaba.qwen.code.cli.protocol.message.SDKResultMessage;
import com.alibaba.qwen.code.cli.protocol.message.assistant.SDKAssistantMessage;
import com.alibaba.qwen.code.cli.protocol.message.control.CLIControlResponse;
import com.alibaba.qwen.code.cli.session.Session;
import com.alibaba.qwen.code.cli.session.event.consumers.SessionEventSimpleConsumers;
import com.alibaba.qwen.code.cli.transport.Transport;
import com.alibaba.qwen.code.cli.transport.TransportOptions;
import com.alibaba.qwen.code.cli.transport.process.ProcessTransport;
import com.alibaba.qwen.code.cli.utils.Timeout;

import org.slf4j.LoggerFactory;

/**
 * Real-stack probe: drives the *bundled* Qwen Code CLI over the real
 * stream-json ProcessTransport, injects a genuine control_request mid-turn so
 * the CLI answers with a real `control_response` carrying subtype=error, and
 * records what the Java SDK does with it.
 *
 * Prints one machine-readable RESULT line; tees every wire line to a file.
 */
public final class RealCliControlResponseProbe {

    public static void main(String[] args) throws Exception {
        String wrapper = System.getenv("PROBE_QWEN_WRAPPER");
        String cwd = System.getenv("PROBE_CWD");
        String home = System.getenv("PROBE_HOME");
        String baseUrl = System.getenv("PROBE_OPENAI_BASE_URL");
        String wireFile = System.getenv("PROBE_WIRE_FILE");
        String variant = System.getenv("PROBE_VARIANT");
        long injectDelayMs = Long.parseLong(System.getenv().getOrDefault("PROBE_INJECT_DELAY_MS", "2500"));

        Map<String, String> env = new HashMap<>();
        env.put("PATH", System.getenv("PATH"));
        env.put("HOME", home);
        env.put("QWEN_HOME", home + "/.qwen");
        env.put("QWEN_BUNDLE", System.getenv("QWEN_BUNDLE"));
        env.put("NO_PROXY", "127.0.0.1,localhost");
        env.put("no_proxy", "127.0.0.1,localhost");
        env.put("OPENAI_API_KEY", "fake-key");
        env.put("OPENAI_BASE_URL", baseUrl);
        env.put("OPENAI_MODEL", "fake-model");
        env.put("QWEN_MODEL", "fake-model");
        env.put("TERM", "dumb");

        TransportOptions options = new TransportOptions()
                .setPathToQwenExecutable(wrapper)
                .setCwd(cwd)
                .setEnv(env)
                .setModel("fake-model")
                .setAuthType("openai")
                .setPermissionMode(PermissionMode.YOLO)
                .setTurnTimeout(new Timeout(120_000L, java.util.concurrent.TimeUnit.MILLISECONDS))
                .setMessageTimeout(new Timeout(120_000L, java.util.concurrent.TimeUnit.MILLISECONDS));

        PrintWriter wire = new PrintWriter(Files.newBufferedWriter(Paths.get(wireFile), StandardCharsets.UTF_8));
        ProcessTransport processTransport = new ProcessTransport(options, line -> wire.println("STDERR  " + line));
        TeeTransport transport = new TeeTransport(processTransport, wire);

        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        ch.qos.logback.classic.Logger sessionLogger =
                (ch.qos.logback.classic.Logger) LoggerFactory.getLogger(Session.class);
        sessionLogger.addAppender(appender);

        AtomicInteger assistants = new AtomicInteger();
        AtomicInteger results = new AtomicInteger();
        AtomicInteger controlResponses = new AtomicInteger();
        List<String> assistantTexts = new ArrayList<>();

        Session session = new Session(transport);

        // Inject a real control_request while the prompt turn is in flight. The
        // CLI's SystemController rejects an empty model, so it replies with a
        // genuine control_response whose subtype lives under `response`.
        String mode = System.getenv().getOrDefault("PROBE_MODE", "raw");
        Thread injector = new Thread(() -> {
            try {
                Thread.sleep(injectDelayMs);
                if ("api".equals(mode)) {
                    // Realistic caller path: the SDK's own public setModel() while a turn is running.
                    wire.println("INJECT  session.setModel(\"\") via public SDK API");
                    wire.println("INJECT-RETURN " + session.setModel(""));
                } else {
                    String request = "{\"type\":\"control_request\",\"request_id\":\"probe-set-model\","
                            + "\"request\":{\"subtype\":\"set_model\",\"model\":\"\"}}";
                    wire.println("INJECT  " + request);
                    transport.inputNoWaitResponse(request);
                }
            } catch (Exception e) {
                wire.println("INJECT-FAIL " + e);
            }
        });
        injector.setDaemon(true);
        injector.start();

        long started = System.nanoTime();
        session.sendPrompt("say hello", new SessionEventSimpleConsumers() {
            @Override
            public void onAssistantMessage(Session s, SDKAssistantMessage m) {
                assistants.incrementAndGet();
            }

            @Override
            public void onControlResponse(Session s, CLIControlResponse<?> r) {
                controlResponses.incrementAndGet();
                // What the typed model actually carries to an SDK consumer.
                wire.println("CONSUMER typedSubtype=" + (r.getResponse() == null ? "<null response>" : r.getResponse().getSubtype())
                        + " typedRequestId=" + (r.getResponse() == null ? "-" : r.getResponse().getRequestId())
                        + " typedPayload=" + (r.getResponse() == null ? "-" : String.valueOf(r.getResponse().getResponse())));
                wire.println("CONSUMER reserialized=" + com.alibaba.fastjson2.JSON.toJSONString(r));
                wire.flush();
            }

            @Override
            public void onResultMessage(Session s, SDKResultMessage m) {
                results.incrementAndGet();
                assistantTexts.add(m.getSubtype() + "/isError=" + m.isError());
            }
        });
        long elapsedMs = (System.nanoTime() - started) / 1_000_000L;

        boolean warned = appender.list.stream()
                .anyMatch(e -> e.getLevel().equals(Level.WARN)
                        && e.getFormattedMessage().contains("control_response error"));
        boolean loggedAtInfo = appender.list.stream()
                .anyMatch(e -> e.getLevel().equals(Level.INFO)
                        && e.getFormattedMessage().contains("control_response error"));

        wire.flush();
        System.out.println("RESULT variant=" + variant
                + " controlResponses=" + controlResponses.get()
                + " assistantMessages=" + assistants.get()
                + " resultMessages=" + results.get()
                + " warnLogged=" + warned
                + " infoLogged=" + loggedAtInfo
                + " turnMs=" + elapsedMs
                + " resultText=" + String.join("|", assistantTexts));
        wire.close();
        session.close();
        System.exit(0);
    }

    /** Delegating transport that records every line the CLI writes. */
    static final class TeeTransport implements Transport {
        private final Transport delegate;
        private final PrintWriter wire;

        TeeTransport(Transport delegate, PrintWriter wire) {
            this.delegate = delegate;
            this.wire = wire;
        }

        @Override
        public TransportOptions getTransportOptions() {
            return delegate.getTransportOptions();
        }

        @Override
        public boolean isReading() {
            return delegate.isReading();
        }

        @Override
        public void start() throws IOException {
            delegate.start();
        }

        @Override
        public void close() throws IOException {
            delegate.close();
        }

        @Override
        public boolean isAvailable() {
            return delegate.isAvailable();
        }

        @Override
        public String inputWaitForOneLine(String message)
                throws IOException, ExecutionException, InterruptedException, TimeoutException {
            wire.println("SEND    " + message);
            String line = delegate.inputWaitForOneLine(message);
            wire.println("RECV    " + line);
            wire.flush();
            return line;
        }

        @Override
        public void inputWaitForMultiLine(String message, Function<String, Boolean> callBackFunction)
                throws IOException {
            wire.println("SEND    " + message);
            wire.flush();
            delegate.inputWaitForMultiLine(message, line -> {
                wire.println("RECV    " + line);
                wire.flush();
                return callBackFunction.apply(line);
            });
        }

        @Override
        public void inputNoWaitResponse(String message) throws IOException {
            wire.println("SEND    " + message);
            wire.flush();
            delegate.inputNoWaitResponse(message);
        }
    }
}
