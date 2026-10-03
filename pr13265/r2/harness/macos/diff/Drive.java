// Java side: the PR's compiled ManagedExtensionProjection.RECORD_BODIES.child_run.
import com.alibaba.qwen.code.managedagent.store.ManagedExtensionProjection;
import com.alibaba.qwen.code.managedagent.store.ManagedExtensionRecords.InvalidRecordException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.*;
import java.nio.charset.StandardCharsets;

public class Drive {
    public static void main(String[] args) throws Exception {
        ObjectMapper json = new ObjectMapper();
        var body = ManagedExtensionProjection.RECORD_BODIES.get("child_run");
        try (BufferedReader in = new BufferedReader(new InputStreamReader(new FileInputStream(args[0]), StandardCharsets.UTF_8));
             PrintWriter out = new PrintWriter(new BufferedWriter(new OutputStreamWriter(new FileOutputStream(args[1]), StandardCharsets.UTF_8)))) {
            String line;
            while ((line = in.readLine()) != null) {
                JsonNode c = json.readTree(line);
                long id = c.get("id").asLong();
                if ("record".equals(c.get("type").textValue())) {
                    String v;
                    try { body.require().accept(c.get("body")); v = "ok"; }
                    catch (InvalidRecordException e) { v = "invalid"; }
                    catch (RuntimeException e) { v = "crash:" + e.getClass().getSimpleName(); }
                    String s;
                    try { s = String.valueOf(body.isStart().test(c.get("body"))); }
                    catch (RuntimeException e) { s = "crash:" + e.getClass().getSimpleName(); }
                    out.println(id + "\t" + v + "\t" + s);
                } else {
                    String s;
                    try { s = String.valueOf(body.isSuccessor().test(c.get("before"), c.get("after"))); }
                    catch (RuntimeException e) { s = "crash:" + e.getClass().getSimpleName(); }
                    out.println(id + "\t" + s);
                }
            }
        }
    }
}
