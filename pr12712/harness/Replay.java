package com.alibaba.qwen.code.runtimebroker.managedworkspace;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * Replays managed-context-v1.fixtures.json against DocWorker, the way the
 * TypeScript test replays it against the module, and prints one summary
 * line: the mutant, the fixture label, and the failing case ids.
 */
public final class Replay {
    public static void main(String[] args) throws Exception {
        String label = args[1];
        JsonNode fixtures = DocWorker.JSON.readTree(
                Files.readString(Path.of(args[0])));
        JsonNode boot = fixtures.get("boot");
        List<String> failed = new ArrayList<>();
        int total = 0;

        for (JsonNode c : fixtures.get("bootCases")) {
            total++;
            boolean parsed = DocWorker.parseBoot(c.get("boot")) != null;
            if (parsed != c.get("valid").booleanValue()) {
                failed.add("boot:" + c.get("id").textValue());
            }
        }
        for (JsonNode c : fixtures.get("readyCases")) {
            total++;
            if (DocWorker.isReady(c.get("ready"), boot)
                    != c.get("valid").booleanValue()) {
                failed.add("ready:" + c.get("id").textValue());
            }
        }
        for (JsonNode c : fixtures.get("attestationCases")) {
            total++;
            JsonNode actual = DocWorker.attest(c.get("body"), boot).toJson();
            if (!actual.equals(c.get("expected"))) {
                failed.add("attest:" + c.get("id").textValue());
            }
        }
        for (JsonNode s : fixtures.get("installationSequences")) {
            total++;
            DocWorker.Installations installations =
                    new DocWorker.Installations(boot);
            int index = 0;
            for (JsonNode step : s.get("steps")) {
                JsonNode actual = installations.install(step.get("request"))
                        .toJson();
                if (!actual.equals(step.get("expected"))) {
                    failed.add("install:" + s.get("id").textValue() + "#"
                            + index);
                    break;
                }
                index++;
            }
        }
        // The canonical records must also be what the worker builds.
        if (!DocWorker.attestationResponse(boot)
                .equals(fixtures.get("attestationResponse"))) {
            failed.add("record:attestationResponse");
        }
        System.out.println(DocWorker.MUTANT + "\t" + label + "\t"
                + failed.size() + "/" + total + "\t"
                + String.join(" ", failed));
    }

    private Replay() {
    }
}
