// Applies the rig-only probe extensions to wt-probe (env-gated; default behavior unchanged).
//  RIG_ALL_FIELDS=1          driver also substitutes each of the seven reference fields under the saved key
//  RIG_RELEASE_REQUEST_LOSS=1 Java probe drops the first release REQUEST (never forwarded) instead of the reply
//  RIG_RELEASE_COUNT=1       candidate assertion: worker closures forwarded == 2 for release-reply (reply loss), else 1
const fs = require('fs');
const path = require('path');
const WT = process.argv[2];
function edit(file, from, to) {
  const p = path.join(WT, file);
  const text = fs.readFileSync(p, 'utf8');
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`${file}: expected 1 match, found ${n}: ${from.slice(0, 60)}`);
  fs.writeFileSync(p, text.replace(from, () => to));
}
const DRIVER = 'integration-tests/helpers/hosted-provider-control-driver.ts';
edit(DRIVER, 'async function changedReference() {\n  const reservation = structuredClone(current.reservation);\n',
  `let rigPhase = 0;
async function changedReference() {
  const reservation = structuredClone(current.reservation);
  if (process.env['RIG_ALL_FIELDS']) {
    rigPhase++;
    for (const field of ['sessionId', 'promptId', 'callId', 'capabilityDigest', 'policyRevision', 'invocationId', 'argsDigest']) {
      const original = current.reference[field] as string;
      const last = original.slice(-1);
      const replacement = field.endsWith('Digest')
        ? original.slice(0, -1) + (last === '0' ? '1' : '0')
        : original + '-changed';
      const response = await fetch(new URL(prefix + 'executions:prepare', baseUrl), {
        method: 'POST',
        headers: { authorization: \`Bearer \${token}\`, 'content-type': 'application/json' },
        body: JSON.stringify({
          protocolVersion: 1, requestId: randomUUID(), harnessSessionId: current.sessionId,
          runtimeSessionId: current.runtimeSessionId, ...reservation,
          reference: { ...current.reference, [field]: replacement },
        }),
        signal: signal(),
      });
      const body = (await response.json()) as { code?: string; executionCallId?: string };
      console.log(\`RIG_FIELD \${current.fault} \${rigPhase === 1 ? 'prepared' : 'settled'} \${field} \${response.status} \${body.code ?? 'ok'} \${body.executionCallId === current.executionCallId ? 'same-id' : body.executionCallId ? 'OTHER-ID' : '-'}\`);
    }
  }
`);
const PROBE = 'packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/HostedProviderControlProbe.java';
edit(PROBE, '        boolean release = kind.equals("release");\n',
  `        boolean release = kind.equals("release");
        if (release && System.getenv("RIG_RELEASE_REQUEST_LOSS") != null && loseReleaseReply && dropped == 0) {
            var lost = sessions.stream().filter(value -> value.get("sessionId")
                    .equals(request.path("session").path("harnessSessionId").asText())).findFirst().orElseThrow();
            if (lost.get("fault").equals("release-reply")) {
                assertThat(sessionState(lost, runtimeId)).isEqualTo("RELEASING");
                dropped++;
                System.out.println("RIG_RELEASE_REQUEST_DROPPED " + runtimeId);
                return;
            }
        }
`);
edit(PROBE, '        if (released) {\n            assertThat(owner(session).get("holder_key")).isNull();\n',
  `        if (released) {
            if (System.getenv("RIG_RELEASE_COUNT") != null) {
                boolean replyLoss = session.get("fault").equals("release-reply")
                        && System.getenv("RIG_RELEASE_REQUEST_LOSS") == null;
                assertThat(releases.getOrDefault(runtimeId, 0)).as("worker closures forwarded")
                        .isEqualTo(replyLoss ? 2 : 1);
            }
            System.out.println("RIG_RELEASES " + session.get("fault") + " forwarded=" + releases.getOrDefault(runtimeId, 0)
                    + " deactivations=" + deactivations.getOrDefault(runtimeId, 0));
            assertThat(owner(session).get("holder_key")).isNull();
`);
console.log('probe patch applied to ' + WT);
