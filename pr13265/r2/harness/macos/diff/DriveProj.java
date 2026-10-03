// Java projection of every record both sides accept (state / runtimeState).
import com.alibaba.qwen.code.managedagent.store.ManagedExtensionProjection;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

public class DriveProj {
    public static void main(String[] args) throws Exception {
        ObjectMapper json = new ObjectMapper();
        Set<String> ok = new HashSet<>(Files.readAllLines(Path.of(args[2])));
        try (BufferedReader in = new BufferedReader(new InputStreamReader(new FileInputStream(args[0]), StandardCharsets.UTF_8));
             PrintWriter out = new PrintWriter(new BufferedWriter(new OutputStreamWriter(new FileOutputStream(args[1]), StandardCharsets.UTF_8)))) {
            String line;
            while ((line = in.readLine()) != null) {
                JsonNode c = json.readTree(line);
                String id = c.get("id").asText();
                if (!"record".equals(c.get("type").textValue()) || !ok.contains(id)) continue;
                JsonNode body = c.get("body");
                var v = ManagedExtensionProjection.project(null, body.get("run"), 1000, body.get("stopRequested").booleanValue());
                out.println(id + "\t" + v.state() + "\t" + v.runtimeState() + "\t" + v.startedAt() + "\t" + v.settledAt());
            }
        }
    }
}
