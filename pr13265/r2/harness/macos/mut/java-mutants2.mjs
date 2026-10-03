// Round 2 Java mutants at head 9c1437ddd6: [id, file, find, replace, scope].
// scope 'child' anchors only after requireChildRun (the Monitor code above it
// repeats several lines); 'file' anchors anywhere in the file.
const DIR = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/';
const REC = DIR + 'ManagedExtensionRecords.java';
const PROJ = DIR + 'ManagedExtensionProjection.java';
const STORE = DIR + 'ManagedExtensionRecordStore.java';
export const MUTANTS = [
  ['J01 kind check dropped', REC, `require("shell".equals(child.get("kind").textValue()),`, `require(true || "shell".equals(child.get("kind").textValue()),`, 'child'],
  ['J02 start call may be absent', REC, `require(!run.get("executionCallId").isNull()\n                && run.get("effectId").isNull()`, `require(run.get("effectId").isNull()`, 'child'],
  ['J04 dispatchId allowed', REC, `&& run.get("dispatchId").isNull()\n                && run.get("deliveryId").isNull()\n                && run.get("delivery").isNull()\n                && run.get("definition").isNull(),\n                "childRun`, `&& run.get("deliveryId").isNull()\n                && run.get("delivery").isNull()\n                && run.get("definition").isNull(),\n                "childRun`, 'child'],
  ['J07 receipt before start allowed', REC, `require(startReceipt.isNull() || execution != null\n                && !"intent".equals(execution)`, `require(true || execution != null\n                && !"intent".equals(execution)`, 'child'],
  ['J09 settled execution without receipt', REC, `|| !"running_attached".equals(execution)\n                        && !"settled".equals(execution),`, `|| !"running_attached".equals(execution),`, 'child'],
  ['J12 output version unchecked', REC, `&& output.get("schemaVersion").asLong() == 1,\n                    "childRun`, `,\n                    "childRun`, 'child'],
  ['J16 negative exitCode allowed', REC, `count(exitCode, 0, 255, "childRun.exitCode");`, `count(exitCode, -1, 255, "childRun.exitCode");`, 'child'],
  ['J18 16-char signal limit +1', REC, `"[A-Z][A-Z0-9]{0,15}"`, `"[A-Z][A-Z0-9]{0,16}"`, 'file'],
  ['J21 stopReason fits state dropped', REC, `|| CHILD_STOP_REASONS.get(state).contains(stopReason),`, `|| true,`, 'child'],
  ['J24 start_failed with receipt', REC, `|| startReceipt.isNull() && execution != null,`, `|| execution != null,`, 'child'],
  ['J25 start_failed never attempted', REC, `|| startReceipt.isNull() && execution != null,`, `|| startReceipt.isNull(),`, 'child'],
  ['J26 process_failed without receipt', REC, `require(!"process_failed".equals(stopReason) || !startReceipt.isNull(),`, `require(true,`, 'child'],
  ['J27 quota iff quota reason dropped', REC, `require("quota_exceeded".equals(stopReason)\n                == (reason != null && QUOTA_REASONS.contains(reason)),`, `require(true,`, 'child'],
  ['J32 ownerScopeId may change', REC, `private static final List<String> CHILD_FIXED = List.of("kind", "shellId",\n            "ownerScopeId", "commandRef");`, `private static final List<String> CHILD_FIXED = List.of("kind", "shellId",\n            "commandRef");`, 'file'],
  ['J38 terminal not frozen', REC, `if (TERMINAL.contains(text(previous.get("run"), "state"))) {\n            return same(previous, next);`, `if (TERMINAL.contains(text(previous.get("run"), "state"))) {\n            return true;`, 'child'],
  ['J41 non-text exitSignal guard dropped', REC, `|| exitSignal.isTextual()\n                        && EXIT_SIGNAL`, `|| EXIT_SIGNAL`, 'child'],
  ['J50 receipt may change (re-attach rule)', REC, `\n                || !previous.get("startReceiptRef").isNull()\n                        && !same(previous.get("startReceiptRef"),\n                                next.get("startReceiptRef"))) {`, `) {`, 'child'],
  ['J51 stopRequested type unchecked', REC, `require(stopRequested.isBoolean(),`, `require(true,`, 'child'],
  ['J52 stop_requested without the flag', REC, `require(!"stop_requested".equals(stopReason)\n                || stopRequested.booleanValue(),`, `require(true,`, 'child'],
  ['J53 start may carry a stop request', REC, `&& !child.get("stopRequested").booleanValue()\n                && child.get("outputRef").isNull();`, `&& child.get("outputRef").isNull();`, 'child'],
  ['J54 stop request may be cleared', REC, `|| previous.get("stopRequested").booleanValue()\n                        && !next.get("stopRequested").booleanValue()\n`, `\n`, 'child'],
  ['J55 draining dropped while attached', PROJ, `return stopRequested ? "draining" : "ready";`, `return "ready";`, 'file'],
  ['J56 draining dropped while provisioning', PROJ, `return stopRequested ? "draining" : "provisioning";`, `return "provisioning";`, 'file'],
  ['J57 store never passes the stop request', STORE, `record.path("stopRequested").asBoolean(false));`, `false);`, 'file'],
  ['J58 server closure skips child_run', STORE, `if (domain.equals("child_run")) {\n            for (String field : List.of("commandRef", "startReceiptRef", "outputRef")) {`, `if (false) {\n            for (String field : List.of("commandRef", "startReceiptRef", "outputRef")) {`, 'file'],
  ['J59 server closure skips outputRef', STORE, `List.of("commandRef", "startReceiptRef", "outputRef")`, `List.of("commandRef", "startReceiptRef")`, 'file'],
];
