# Round 2, full-stack addendum — PR QwenLM/qwen-code#10357

Companion to [`round2/`](../round2). Same head, same conclusions, different rig: this bundle
runs the **whole product** rather than the channel classes in-process.

| | |
| --- | --- |
| head | `90eb0a9a61` |
| base | `168a88c02e` (`origin/main` at the time of the run) |
| tree actually exercised | `1d5a1383e5` = `168a88c02e` + `90eb0a9a61`, clean merge |
| host | macOS, Node v24.18.1; container image `node:22-bookworm` |

## The rig

`rig/rig.mjs` runs the **bundled** `qwen channel start dt` (`dist/cli.js`, built with
`npm run build && npm run bundle` from each tree) inside a Linux container started with
`--network none` and `--add-host api.dingtalk.com:127.0.0.1 --add-host oapi.dingtalk.com:127.0.0.1`.
A self-signed cert for both hostnames is trusted through `NODE_EXTRA_CA_CERTS`, so the channel
reaches the real hostnames over real TLS and nothing can leak to DingTalk.

| port | what it serves |
| --- | --- |
| HTTPS 443 | `oapi…/gettoken`, `api…/v1.0/gateway/connections/open`, `card/instances/createAndDeliver`, `card/streaming`, `card/instances` |
| WS 8899 | the DingTalk Stream gateway; the SDK connects to the endpoint the open call returns, then receives a real `/v1.0/im/bot/messages/get` CALLBACK frame |
| HTTP 8080 | `sessionWebhook` — where plain-text fallback replies land |
| HTTP 8081 | an OpenAI-compatible endpoint streaming a 2604-character answer over ~17 s |

Nothing in `packages/` is patched or mocked: the DingTalk SDK handshake, `DingtalkChannel`'s own
`gettoken`, `DingtalkInteractionPresenter`, `StatusCardController` and
`DingtalkInteractiveCardClient` all run as shipped. Faults are injected by destroying the socket
or returning a status code, so the PR's own `DingtalkCardRequestError` classification runs for
real.

Two simulated DingTalk clients subscribe to the card: streaming frames reach only clients online
at that moment and are not replayed on reconnect (`CLIENT_MODEL=m2`); instance updates reach
whoever is online.

## Scenarios (`results/fullstack/<variant>-<scenario>.json`)

| scenario | fault |
| --- | --- |
| `happy` | none |
| `content-outage` | all Card OpenAPI black-holed for 3 s, starting 2 s after the card is created |
| `terminal-outage` | all Card OpenAPI black-holed for 5 s, armed 3 chunks before the model finishes so it covers finalize + terminal write |
| `terminal-outage-permanent` | same, never restored (measures the retry ceiling) |
| `create-outage` | all Card OpenAPI black-holed for 4 s from the moment the message arrives, so `createAndDeliver` itself is refused |
| `client-reconnect` | client A offline 2.0 s → 5.3 s after card creation |
| `token-permanent` / `token-transient` | every `gettoken` answers `errcode 40001` / `errcode -1` once the channel is already online |

## Also here

* `results/driver/` — the round-1 in-process harness re-run on both trees (`origin/main` as base this time).
* `results/mutants*.{json,log,py}` — a 13-mutant sweep; see the correction below.
* `results/suite-15-runs.log` — 15 consecutive clean runs of the DingTalk suite.

## Correction to `results/mutants-fullstack-sweep.json`

The sweep records `stream retry: drop the streamRetryAttempt reset on success` as CAUGHT, but the
only failing test was `DingtalkAdapter.test.ts > DingtalkChannel quoted media > still delivers the
text when an over-long quoted file name fails the store`, which that line cannot affect. Re-running
that mutant three times, the suite passes every time; the unmutated suite passed 21/21 runs.
**That mutant survives** — matching `round2/`'s independent finding.

## Reproducing

```bash
cd rig
docker build -t qwen-dingtalk-rig .
./run-all.sh                       # every scenario, both trees
./run-one.sh head terminal-outage-permanent
python3 render2.py && node shoot.mjs
```
