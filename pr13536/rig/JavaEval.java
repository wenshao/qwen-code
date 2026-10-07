// VERIFICATION RIG ONLY (PR #13536): Java side of the differential — ManagedExtensionRecordStore.parse
// (the store's strict reader) + ManagedExtensionProjection.RECORD_BODIES (require / recordId /
// taskKindOf / isStart / isSuccessor), exactly the calls the store's commit path makes.
import com.alibaba.qwen.code.managedagent.store.ManagedExtensionProjection;
import com.alibaba.qwen.code.managedagent.store.ManagedExtensionRecordStore;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.*;
import java.nio.charset.StandardCharsets;

public class JavaEval {
    public static void main(String[] args) throws Exception {
        ObjectMapper m = new ObjectMapper();
        try (BufferedReader in = new BufferedReader(new InputStreamReader(new FileInputStream(args[0]), StandardCharsets.UTF_8));
             PrintWriter out = new PrintWriter(new OutputStreamWriter(new FileOutputStream(args[1]), StandardCharsets.UTF_8))) {
            String line; int n = 0;
            while ((line = in.readLine()) != null) {
                JsonNode row = m.readTree(line);
                ObjectNode res = m.createObjectNode();
                res.put("id", row.get("id").textValue());
                ManagedExtensionProjection.Body body = ManagedExtensionProjection.RECORD_BODIES.get(row.get("domain").textValue());
                if (row.get("op").textValue().equals("one")) {
                    JsonNode v = ManagedExtensionRecordStore.parse(row.get("a").textValue());
                    if (v == null) { res.put("read", false); }
                    else if (body == null) { res.put("read", true); res.put("ok", false); res.put("err", "no body registered"); }
                    else {
                        res.put("read", true);
                        try {
                            body.require().accept(v);
                            res.put("ok", true);
                            res.put("rid", body.recordId().apply(v));
                            String tk = body.taskKindOf().apply(v);
                            if (tk == null) res.putNull("task"); else res.put("task", tk);
                            res.put("start", body.isStart().test(v));
                        } catch (RuntimeException e) {
                            res.put("ok", false); res.put("err", String.valueOf(e.getMessage())); res.put("cls", e.getClass().getSimpleName());
                        }
                    }
                } else {
                    JsonNode a = ManagedExtensionRecordStore.parse(row.get("a").textValue());
                    JsonNode b = ManagedExtensionRecordStore.parse(row.get("b").textValue());
                    if (a == null || b == null) res.put("read", false);
                    else {
                        res.put("read", true);
                        try { res.put("succ", body.isSuccessor().test(a, b)); }
                        catch (RuntimeException e) { res.put("succ", "THROW:" + e.getClass().getSimpleName() + ":" + e.getMessage()); }
                    }
                }
                out.println(m.writeValueAsString(res));
                n++;
            }
            System.err.println("java-eval " + n + " rows");
        }
    }
}
