"""Candidate fix arm for the unknown -> partial -> sending bypass (not pushed anywhere).
usage: python3 apply-fix.py <worktree>
"""
import json, sys

root = sys.argv[1]
ts = f'{root}/packages/core/src/managed-runtime/managed-channel-record.ts'
jv = f'{root}/packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ManagedChannelRecords.java'
fx = f'{root}/packages/core/src/managed-runtime/contracts/managed-channel-record-v1.fixtures.json'


def sub(path, old, new):
    src = open(path).read()
    assert src.count(old) == 1, (path, old[:60])
    open(path, 'w').write(src.replace(old, new))


sub(ts, """    if (TERMINAL_RUN_STATES.includes(before.run.state)) {
      return same(before, after);
    }
    return true;
  });
}""", """    // Leaving unknown takes proof: a partial revision must settle a
    // segment the unknown one did not, or the next sending revision could
    // re-send a segment the provider may already hold (decision 5).
    const settled = (record: ChannelDelivery) =>
      record.segments.filter((segment) => segment.receipt !== null).length;
    if (
      before.run.delivery!.state === 'unknown' &&
      after.run.delivery!.state === 'partial' &&
      settled(after) <= settled(before)
    ) {
      return false;
    }
    if (TERMINAL_RUN_STATES.includes(before.run.state)) {
      return same(before, after);
    }
    return true;
  });
}""")

sub(jv, """            if (ManagedExtensionRecords.TERMINAL.contains(
                    previous.get("run").get("state").textValue())) {
                return ManagedExtensionRecords.same(previous, next);
            }
            return true;""", """            // Leaving unknown takes proof (decision 5).
            if ("unknown".equals(previous.at("/run/delivery/state").textValue())
                    && "partial".equals(next.at("/run/delivery/state").textValue())
                    && settled(next) <= settled(previous)) {
                return false;
            }
            if (ManagedExtensionRecords.TERMINAL.contains(
                    previous.get("run").get("state").textValue())) {
                return ManagedExtensionRecords.same(previous, next);
            }
            return true;""")
sub(jv, """    private static String nullableId(JsonNode node, String label) {""", """    private static int settled(JsonNode record) {
        int count = 0;
        for (JsonNode segment : record.get("segments")) {
            if (!segment.get("receipt").isNull()) {
                count++;
            }
        }
        return count;
    }

    private static String nullableId(JsonNode node, String label) {""")

# Corpus: the old shape becomes a refusal; "proves partial" gets a real proof.
data = json.load(open(fx))
cases = data['successors']
i = next(k for k, c in enumerate(cases) if c['id'] == 'delivery-unknown-proves-partial')
old = cases[i]
refusal = json.loads(json.dumps(old))
refusal['id'] = 'delivery-unknown-partial-without-proof'
refusal['valid'] = False
seg3 = {'segmentId': 'seg-3', 'ordinal': 2, 'contentRef': {'resourceId': 'seg-3-data', 'kind': 'channel-delivery-segment', 'schemaVersion': 1, 'byteLength': 2, 'digest': 'e' * 64}, 'receipt': None}
proof = json.loads(json.dumps(old))
for side in ('before', 'after'):
    proof[side]['segments'] = proof[side]['segments'] + [json.loads(json.dumps(seg3))]
second = json.loads(json.dumps(proof['after']['segments'][0]['receipt']))
second['providerMessageId'] = 'provider-msg-2'
proof['after']['segments'][1]['receipt'] = second
cases[i] = proof
cases.insert(i + 1, refusal)
json.dump(data, open(fx, 'w'), indent=2, ensure_ascii=False)
open(fx, 'a').write('\n')
print('fix applied')
