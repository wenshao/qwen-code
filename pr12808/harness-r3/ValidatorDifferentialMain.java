package com.alibaba.qwen.code.managedagent;

import com.alibaba.qwen.code.managedagent.OpenApiContract.Operation;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.networknt.schema.AnnotationKeyword;
import com.networknt.schema.JsonMetaSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SchemaLocation;
import com.networknt.schema.SchemaValidatorsConfig;
import com.networknt.schema.SpecVersion.VersionFlag;
import com.networknt.schema.ValidationMessage;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * VERIFICATION RIG ONLY (PR 12808 round 3): runs the same (schema pointer,
 * instance) pairs through the pre-a9791442 validator factory and the
 * a9791442 factory (unknown keywords as AnnotationKeyword) and compares the
 * reported messages. Corpus = recorded real traffic + systematic corruptions.
 */
public final class ValidatorDifferentialMain {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final SchemaValidatorsConfig CONFIG = SchemaValidatorsConfig
            .builder().formatAssertionsEnabled(true).build();
    private static final JsonSchemaFactory OLD =
            JsonSchemaFactory.getInstance(VersionFlag.V202012);
    private static final JsonSchemaFactory NEW = JsonSchemaFactory.getInstance(
            VersionFlag.V202012, builder -> builder.metaSchema(JsonMetaSchema
                    .builder(JsonMetaSchema.getV202012())
                    .unknownKeywordFactory((keyword, context) ->
                            new AnnotationKeyword(keyword))
                    .build()));

    public static void main(String[] args) throws Exception {
        OpenApiContract contract = OpenApiContract.load();
        List<String[]> pairs = new ArrayList<>(); // pointer, label
        List<JsonNode> instances = new ArrayList<>();
        for (String file : args) {
            for (String line : Files.readAllLines(Path.of(file))) {
                if (line.isBlank()) {
                    continue;
                }
                JsonNode entry = JSON.readTree(line);
                String opId = entry.path("op").asText();
                Operation op = contract.operation(opId);
                if (entry.hasNonNull("request")) {
                    String pointer = contract.requestPointer(op);
                    if (pointer != null) {
                        pairs.add(new String[] {pointer, "request " + opId});
                        instances.add(entry.get("request"));
                    }
                }
                if ("exchange".equals(entry.path("kind").asText())
                        && entry.hasNonNull("body")) {
                    String declared = contract.responsePointer(op,
                            entry.path("status").asInt());
                    if (declared != null && !contract.node(declared
                            + "/content/application~1json/schema")
                            .isMissingNode()) {
                        pairs.add(new String[] {declared
                                + "/content/application~1json/schema",
                                "response " + opId + " "
                                        + entry.path("status").asInt()});
                        instances.add(entry.get("body"));
                    }
                }
                if ("stream".equals(entry.path("kind").asText())) {
                    String schema = opId.equals("getSessionEvents")
                            ? "PublicEvent" : "WebShellEvent";
                    String text = entry.path("text").asText();
                    int end = text.lastIndexOf("\n\n");
                    for (String frame : text.substring(0, Math.max(end, 0))
                            .split("\n\n")) {
                        for (String l : frame.split("\n")) {
                            if (l.startsWith("data:")) {
                                pairs.add(new String[] {
                                        "/components/schemas/" + schema,
                                        "sse " + opId});
                                instances.add(JSON.readTree(l.substring(5)));
                            }
                        }
                    }
                }
            }
        }
        int real = instances.size();
        // Systematic corruptions of every real instance.
        List<String[]> extraPairs = new ArrayList<>();
        List<JsonNode> extra = new ArrayList<>();
        for (int i = 0; i < real; i++) {
            for (JsonNode variant : corruptions(instances.get(i))) {
                extraPairs.add(pairs.get(i));
                extra.add(variant);
            }
        }
        pairs.addAll(extraPairs);
        instances.addAll(extra);

        int same = 0;
        int differ = 0;
        int withErrors = 0;
        Map<String, Integer> keywords = new TreeMap<>();
        List<String> diffs = new ArrayList<>();
        for (int i = 0; i < instances.size(); i++) {
            String pointer = pairs.get(i)[0];
            Set<String> a = render(OLD, pointer, instances.get(i));
            Set<String> b = render(NEW, pointer, instances.get(i));
            if (!b.isEmpty()) {
                withErrors++;
            }
            for (String m : b) {
                keywords.merge(m.split("\\|")[1], 1, Integer::sum);
            }
            if (a.equals(b)) {
                same++;
            } else {
                differ++;
                if (diffs.size() < 10) {
                    diffs.add(pairs.get(i)[1] + " old=" + a + " new=" + b);
                }
            }
        }
        System.out.println("real instances: " + real);
        System.out.println("corrupted instances: " + extra.size());
        System.out.println("total pairs: " + instances.size()
                + "  identical message sets: " + same + "  different: "
                + differ);
        System.out.println("instances with >=1 message: " + withErrors);
        System.out.println("message keywords (new factory): " + keywords);
        diffs.forEach(d -> System.out.println("DIFF " + d));
    }

    private static Set<String> render(JsonSchemaFactory factory,
            String pointer, JsonNode instance) {
        Set<ValidationMessage> messages = factory.getSchema(SchemaLocation.of(
                "classpath:" + OpenApiContract.RESOURCE + "#" + pointer),
                CONFIG).validate(instance);
        Set<String> out = new TreeSet<>();
        for (ValidationMessage m : messages) {
            out.add(m.getInstanceLocation() + "|" + m.getType() + "|"
                    + m.getProperty() + "|" + m.getMessage());
        }
        return out;
    }

    private static List<JsonNode> corruptions(JsonNode node) {
        List<JsonNode> out = new ArrayList<>();
        if (!node.isObject()) {
            return out;
        }
        List<String> names = new ArrayList<>();
        node.fieldNames().forEachRemaining(names::add);
        for (String name : names) {
            ObjectNode dropped = node.deepCopy();
            dropped.remove(name);
            out.add(dropped);
            JsonNode value = node.get(name);
            ObjectNode retyped = node.deepCopy();
            if (value.isTextual()) {
                retyped.put(name, 12345);
            } else if (value.isNumber() || value.isBoolean()) {
                retyped.put(name, "not-a-" + value.getNodeType());
            } else {
                retyped.put(name, true);
            }
            out.add(retyped);
            if (value.isTextual()) {
                ObjectNode bogus = node.deepCopy();
                bogus.put(name, "bogus_value_xyz");
                out.add(bogus);
                ObjectNode empty = node.deepCopy();
                empty.put(name, "");
                out.add(empty);
            }
            if (value.isNumber()) {
                ObjectNode negative = node.deepCopy();
                negative.put(name, -1);
                out.add(negative);
            }
            if (value.isObject()) {
                for (JsonNode nested : corruptions(value)) {
                    ObjectNode copy = node.deepCopy();
                    copy.set(name, nested);
                    out.add(copy);
                }
            }
            if (value.isArray() && value.size() > 0
                    && value.get(0).isObject()) {
                for (JsonNode nested : corruptions(value.get(0))) {
                    ObjectNode copy = node.deepCopy();
                    ArrayNode array = copy.putArray(name);
                    array.add(nested);
                    Iterator<JsonNode> rest = value.elements();
                    rest.next();
                    rest.forEachRemaining(array::add);
                    out.add(copy);
                }
            }
        }
        ObjectNode extraProp = node.deepCopy();
        extraProp.put("unexpected_rig_field", "x");
        out.add(extraProp);
        return out;
    }
}
