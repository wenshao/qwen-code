import com.alibaba.qwen.code.managedagent.store.ManagedExtensionRecords;
import com.alibaba.qwen.code.managedagent.store.ManagedExtensionRecords.InvalidRecordException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.FileReader;
import java.io.FileWriter;

/**
 * Replays JSONL cases through the compiled ManagedExtensionRecords class
 * with Jackson's default mapper. Prints 1/0 per case, or X:<exception> for
 * a throw that is not a contract refusal (P:<exception> if Jackson cannot
 * read the line at all).
 */
public class Drive {
    public static void main(String[] args) throws Exception {
        ObjectMapper json = new ObjectMapper();
        try (BufferedReader in = new BufferedReader(new FileReader(args[0]));
                BufferedWriter out = new BufferedWriter(new FileWriter(args[1]))) {
            String line;
            while ((line = in.readLine()) != null) {
                if (line.isEmpty()) {
                    continue;
                }
                JsonNode c;
                try {
                    c = json.readTree(line);
                } catch (Exception e) {
                    out.write("P:" + e.getClass().getSimpleName() + "\n");
                    continue;
                }
                String k = c.get("k").textValue();
                JsonNode a = c.get("a");
                JsonNode b = c.get("b");
                String verdict;
                try {
                    boolean ok = switch (k) {
                        case "grant" -> run(() -> ManagedExtensionRecords.requireOperationGrant(a));
                        case "pin" -> run(() -> ManagedExtensionRecords.requireDefinitionPin(a));
                        case "run" -> run(() -> ManagedExtensionRecords.requireRun(a));
                        case "monitor" -> run(() -> ManagedExtensionRecords.requireMonitorRun(a));
                        case "grantSucc" -> ManagedExtensionRecords.isOperationGrantSuccessor(a, b);
                        case "pinPair" -> ManagedExtensionRecords.isDefinitionPinConsistent(a, b);
                        case "runSucc" -> ManagedExtensionRecords.isRunSuccessor(a, b);
                        case "monitorSucc" -> ManagedExtensionRecords.isMonitorRunSuccessor(a, b);
                        default -> throw new IllegalStateException(k);
                    };
                    verdict = ok ? "1" : "0";
                } catch (InvalidRecordException e) {
                    verdict = "0";
                } catch (Throwable e) {
                    String msg = String.valueOf(e.getMessage());
                    verdict = "X:" + e.getClass().getSimpleName() + ":"
                            + msg.substring(0, Math.min(80, msg.length())).replace('\n', ' ');
                }
                out.write(verdict + "\n");
            }
        }
    }

    private static boolean run(Runnable r) {
        r.run();
        return true;
    }
}
