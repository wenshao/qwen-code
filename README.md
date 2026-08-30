# PR 9318 verification evidence

Local end-to-end verification of QwenLM/qwen-code#9318
(`fix(channel-weixin): preserve large message IDs`), run on Linux / Node 22.

Everything was driven against a **real HTTP server** speaking the WeChat iLink Bot API,
whose `getupdates` replies are written as raw JSON text so `message_id` really is a
64-bit JSON number literal on the wire. No `fetch` stubbing.

| file | what it shows |
| --- | --- |
| `01-ab-core-fix.png` | A/B: pre-PR rounds `7489534892789344264` to `...000`; the PR keeps it exact |
| `02-number-fidelity-matrix.png` | json-bigint's rule is `token length > 15`, not "outside the safe range" |
| `03-behaviour-changes.png` | A/B of the collateral behaviour changes (empty body, HTML body, `__proto__`, `1e400`) |
| `04-real-cli-roundtrip.png` | real `qwen channel start weixin` on the shipped bundle: full round trip |
| `05-error-shape-regression.png` | json-bigint throws a non-`Error`, so the poll-loop log becomes `[object Object]` |
| `06-test-non-vacuity.png` | `api.test.ts` pins the fix; `monitor.test.ts` passes without it |
| `07-zero-dep-alternative.png` | a zero-dependency alternative, built and run through the same probes |
| `08-empty-body-hot-loop.png` | an HTTP 200 with an empty body: a throttled failure becomes a silent ~2,700 req/s loop |
