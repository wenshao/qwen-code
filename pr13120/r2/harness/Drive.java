import com.alibaba.qwen.code.managedagent.store.ManagedExtensionRecords;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.File;
import java.util.HashSet;
import java.util.Set;

/** Judges the cases a PR adds with the compiled Java contract class. */
public class Drive {
    interface Check {
        Object run(JsonNode fixture) throws Exception;
    }

    public static void main(String[] args) throws Exception {
        ObjectMapper json = new ObjectMapper();
        JsonNode head = json.readTree(new File(args[0]));
        JsonNode base = json.readTree(new File(args[1]));
        judge(head, base, "grantCases", f -> {
            ManagedExtensionRecords.requireOperationGrant(f.get("grant"));
            return true;
        });
        judge(head, base, "runCases", f -> {
            ManagedExtensionRecords.requireRun(f.get("run"));
            return true;
        });
        judge(head, base, "monitorRunCases", f -> {
            ManagedExtensionRecords.requireMonitorRun(f.get("monitorRun"));
            return true;
        });
        judge(head, base, "grantSuccessorCases", f -> ManagedExtensionRecords
                .isOperationGrantSuccessor(f.get("previous"), f.get("next")));
        judge(head, base, "monitorRunSuccessorCases", f -> ManagedExtensionRecords
                .isMonitorRunSuccessor(f.get("previous"), f.get("next")));
        for (String[] call : new String[][] {{null, "reserved", "admitted"},
                {"run", null, "admitted"}, {"run", "reserved", null}}) {
            String label = "isTransitionAllowed(" + call[0] + "," + call[1]
                    + "," + call[2] + ")";
            try {
                System.out.println("JAVA\ttransition\t" + label + "\tfalse\t"
                        + ManagedExtensionRecords.isTransitionAllowed(call[0],
                                call[1], call[2]) + "\t");
            } catch (RuntimeException e) {
                System.out.println("JAVA\ttransition\t" + label + "\tfalse\tTHROWS\t"
                        + e.getClass().getSimpleName() + ": " + e.getMessage());
            }
        }
    }

    static void judge(JsonNode head, JsonNode base, String list, Check check) {
        Set<String> known = new HashSet<>();
        base.get(list).forEach(f -> known.add(f.get("id").textValue()));
        for (JsonNode fixture : head.get(list)) {
            String id = fixture.get("id").textValue();
            if (known.contains(id)
                    && !id.equals("restarts-a-settled-watch-under-the-same-runtime")) {
                continue;
            }
            String verdict;
            String error = "";
            try {
                verdict = String.valueOf(check.run(fixture));
            } catch (ManagedExtensionRecords.InvalidRecordException e) {
                verdict = "false";
                error = "InvalidRecordException: " + e.getMessage();
            } catch (Exception e) {
                verdict = "THROWS";
                error = e.getClass().getSimpleName() + ": " + e.getMessage();
            }
            System.out.println("JAVA\t" + list + "\t" + id + "\t"
                    + fixture.get("valid").booleanValue() + "\t" + verdict + "\t"
                    + error);
        }
    }
}
