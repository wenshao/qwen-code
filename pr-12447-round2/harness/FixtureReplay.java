import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Real JDK consumer of the PR's shared fixture file: materialises every case the
 * same way the TypeScript test does and sends it with java.net.http.HttpClient
 * (the client the future Runtime Broker transport will use) to the PR's
 * TypeScript contract running behind a real node:http listener.
 */
public final class FixtureReplay {
    private static final ObjectMapper JSON = new ObjectMapper();

    public static void main(String[] args) throws Exception {
        Path fixtures = Path.of(args[0]);
        String origin = args[1];
        HttpClient.Version version = HttpClient.Version.valueOf(args[2]);
        JsonNode suite = JSON.readTree(fixtures.toFile());
        JsonNode route = suite.required("route");
        JsonNode success = null;
        for (JsonNode c : suite.required("cases")) {
            if ("success".equals(c.required("id").textValue())) {
                success = c;
            }
        }
        HttpClient client = HttpClient.newBuilder().version(version)
                .connectTimeout(Duration.ofSeconds(5)).build();
        int ok = 0;
        int total = 0;
        System.out.printf("JDK %s  HttpClient.Version.%s  -> %s%n",
                Runtime.version(), version, origin);
        for (JsonNode c : suite.required("cases")) {
            total++;
            JsonNode req = c.required("request");
            Map<String, String> headers = new LinkedHashMap<>();
            success.required("request").required("headers").properties()
                    .forEach(e -> headers.put(e.getKey(), e.getValue().textValue()));
            ObjectNode body = ((ObjectNode) success.required("request").required("body")).deepCopy();
            if (req.has("omitHeader")) {
                headers.remove(req.get("omitHeader").textValue());
            }
            if (req.has("replaceHeader")) {
                headers.put(req.get("replaceHeader").get("name").textValue(),
                        req.get("replaceHeader").get("value").textValue());
            }
            if (req.has("replaceBody")) {
                body.set(req.get("replaceBody").get("name").textValue(),
                        req.get("replaceBody").get("value"));
            }
            if (req.has("paddingBytes")) {
                body.put("padding", "x".repeat(req.get("paddingBytes").intValue()));
            }
            String payload = req.has("rawBody") ? req.get("rawBody").textValue()
                    : JSON.writeValueAsString(body);
            String path = req.has("pathOverride") ? req.get("pathOverride").textValue()
                    : route.required("path").textValue();
            String suffix = req.has("pathSuffix") ? req.get("pathSuffix").textValue() : "";
            String method = req.has("method") ? req.get("method").textValue()
                    : route.required("method").textValue();
            HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(origin + path + suffix))
                    .timeout(Duration.ofSeconds(10));
            headers.forEach(b::header);
            b.method(method, "GET".equals(method) ? HttpRequest.BodyPublishers.noBody()
                    : HttpRequest.BodyPublishers.ofString(payload, StandardCharsets.UTF_8));
            String outcome;
            boolean pass;
            try {
                HttpResponse<String> r = client.send(b.build(), HttpResponse.BodyHandlers.ofString());
                JsonNode expected = c.required("expected");
                String cls = classify(r.statusCode());
                boolean noStore = "no-store".equals(r.headers().firstValue("cache-control").orElse(null));
                boolean bodyOk = true;
                if (expected.has("body")) {
                    bodyOk = r.body().getBytes(StandardCharsets.UTF_8).length
                            <= route.required("responseBodyLimitBytes").intValue()
                            && JSON.readTree(r.body()).equals(expected.get("body"));
                }
                boolean codeOk = true;
                if (expected.has("code")) {
                    try {
                        codeOk = expected.get("code").equals(JSON.readTree(r.body()).get("code"));
                    } catch (Exception notJson) {
                        codeOk = false;
                    }
                }
                pass = codeOk && r.statusCode() == expected.required("status").intValue()
                        && cls.equals(expected.required("classification").textValue())
                        && noStore && bodyOk;
                outcome = String.format("%d %-12s no-store=%s%s  wire=%s", r.statusCode(), cls,
                        noStore ? "y" : "N", (expected.has("body") ? (bodyOk ? " body=exact" : " body=DIFF") : "")
                                + (expected.has("code") ? (codeOk ? " code=ok" : " code=MISMATCH:" + contentType(r)) : ""),
                        r.version());
            } catch (Exception e) {
                pass = false;
                outcome = e.getClass().getSimpleName() + ": " + e.getMessage();
            }
            if (pass) {
                ok++;
            }
            System.out.printf("%s %-28s %s%n", pass ? "PASS" : "FAIL",
                    c.required("id").textValue(), outcome);
        }
        System.out.printf("%d/%d fixture cases conform from the JDK client%n", ok, total);
        System.exit(ok == total ? 0 : 1);
    }

    private static String contentType(HttpResponse<String> r) {
        return r.headers().firstValue("content-type").orElse("none").split(";")[0];
    }

    private static String classify(int status) {
        if (status == 200) {
            return "ok";
        }
        if (status == 401 || status == 403) {
            return "credentials";
        }
        if (status == 400 || status == 413) {
            return "protocol";
        }
        if (status == 409) {
            return "identity";
        }
        if (status == 404 || status == 405) {
            return "incompatible";
        }
        return "UNCLASSIFIED";
    }
}
