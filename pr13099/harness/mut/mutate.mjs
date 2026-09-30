// VERIFICATION RIG ONLY: single-site mutations of HarnessCoordinator.java.
// usage: node mutate.mjs <id> <pristine> <out>     (id M0 = pristine copy)
import fs from 'node:fs';

const RBE_GUARD =
  'terminal = !submissionAttempted.get() && !error.isRetryable()';
const RBE_ARM = `        } catch (RuntimeBrokerException error) {
            terminal = !submissionAttempted.get() && !error.isRetryable()
                    ? fail(claimed, error.getCode(), error.getMessage())
                    : transientFailure(claimed, submissionAttempted.get(), error);
`;
const HTTP_ARM = `            if (error.getStatusCode() >= 400
                    && error.getStatusCode() < 500
                    && error.getStatusCode() != 409) {
                terminal = fail(claimed, "hosted_harness_rejected",
                        "Hosted Harness rejected the Turn.");
            } else {
                terminal = transientFailure(claimed,
                        submissionAttempted.get(), error);
            }
`;

export const MUTATIONS = {
  M0: { note: 'intact production code', edits: [] },
  M1: {
    note: 'author #1: RBE guard drops !submissionAttempted (-> !error.isRetryable())',
    edits: [[RBE_GUARD, 'terminal = !error.isRetryable()']],
  },
  M2: {
    note: 'author #2: RBE guard drops !error.isRetryable() (-> !submissionAttempted.get())',
    edits: [[RBE_GUARD, 'terminal = !submissionAttempted.get()']],
  },
  M3: {
    note: 'author #3: 409 joins the DaemonHttpException "rejected" branch',
    edits: [['\n                    && error.getStatusCode() != 409) {', ') {']],
  },
  M4: {
    note: 'delete the RuntimeBrokerException arm (generic catch takes over)',
    edits: [[RBE_ARM, '']],
  },
  M5: {
    note: 'RBE arm always terminal (no guard at all)',
    edits: [
      [
        RBE_ARM,
        `        } catch (RuntimeBrokerException error) {
            terminal = fail(claimed, error.getCode(), error.getMessage());
`,
      ],
    ],
  },
  M6: {
    note: 'RBE arm fails with a fixed code instead of error.getCode()',
    edits: [
      [
        '? fail(claimed, error.getCode(), error.getMessage())',
        '? fail(claimed, "hosted_harness_unavailable", error.getMessage())',
      ],
    ],
  },
  M7: {
    note: 'delete the hosted_harness_rejected branch (every HTTP error transient)',
    edits: [
      [
        HTTP_ARM,
        `            terminal = transientFailure(claimed,
                    submissionAttempted.get(), error);
`,
      ],
    ],
  },
  M8: {
    note: 'widen "< 500" to "< 600" (5xx becomes terminal)',
    edits: [['&& error.getStatusCode() < 500', '&& error.getStatusCode() < 600']],
  },
  M9: {
    note: 'transientFailure: exhaustion ignores submissionAttempted',
    edits: [
      [
        `        if (!submissionAttempted
                && turn.retryCount() >= maxPreAdmissionRetries) {`,
        '        if (turn.retryCount() >= maxPreAdmissionRetries) {',
      ],
    ],
  },
};

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [id, pristine, out] = process.argv.slice(2);
  const m = MUTATIONS[id];
  if (!m) throw new Error(`unknown mutation ${id}`);
  let src = fs.readFileSync(pristine, 'utf8');
  for (const [from, to] of m.edits) {
    const n = src.split(from).length - 1;
    if (n !== 1) throw new Error(`${id}: expected 1 match, found ${n}: ${from.slice(0, 60)}`);
    src = src.replace(from, () => to);
  }
  fs.writeFileSync(out, src);
  console.log(`${id}: ${m.note}`);
}
