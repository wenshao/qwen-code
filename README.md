# PR #7815 — local verification evidence

Screenshots captured while verifying `feat(core): persist and replay Goal v3 state`
against a real `npm ci` build (PR head) and a real merge-base build.

- `01-write-path.png` — real GoalRuntime + real ChatRecordingService writing a real session JSONL
- `02-replay-ab.png` — two real `qwen serve` daemons (merge-base vs PR) replaying the same transcript
- `03-fault-rewind.png` — real EISDIR write failure + rewind-boundary A/B (fix toggled off/on)
