// Candidate B (optional, test-only): a Harness that has exited fails the startup wait at once instead of
// after the full 30 s. Applies to HostedPublicWorkspaceIT at 6a602cde. usage: node apply-candidate-b.mjs <worktree>
import { readFileSync, writeFileSync } from 'node:fs';
const f = `${process.argv[2]}/packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/HostedPublicWorkspaceIT.java`;
let s = readFileSync(f, 'utf8');
const from = `        await().atMost(Duration.ofSeconds(30)).ignoreExceptions().untilAsserted(() -> {
            if (!harness.isAlive()) {
                throw new AssertionError("Hosted Harness exited: " + Files.readString(log));
            }
            assertThat(`;
const to = `        await().atMost(Duration.ofSeconds(30)).ignoreExceptions().failFast(() -> {
            if (!harness.isAlive()) {
                throw new AssertionError("Hosted Harness exited: " + Files.readString(log));
            }
        }).untilAsserted(() -> {
            assertThat(`;
if (s.split(from).length !== 2) throw new Error('anchor not unique');
writeFileSync(f, s.replace(from, to));
console.log('candidate B applied');
