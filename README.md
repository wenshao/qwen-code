# PR #10457 verification assets

Screenshots produced while verifying
[QwenLM/qwen-code#10457](https://github.com/QwenLM/qwen-code/pull/10457)
(`feat(dingtalk): present tool permission requests with native interactive cards`)
on Linux with a local full-stack DingTalk harness (PR head `d4fc363`).

The card renderings are the harness's approximation of the DingTalk form card,
drawn from the exact `cardParamMap` the daemon put on the wire. They are not
screenshots of a DingTalk client.

## Round 2 (2026-09-03, PR head `0de5699b`, macOS)

`imgs/r2-*.png` are terminal captures of the round-2 harness output
(`tmp/pr10457-verify-20260903-120955/` in the verifier's checkout): a joined
real-`ChannelBase` + real-`DingtalkChannel` wire oracle against a loopback
DingTalk API, a locale oracle that uses the product's own i18n as reference,
and a 12-cell mutation matrix. Round-1 images above are untouched.


## Round 4 (2026-09-09, PR head `d2026842`, macOS host / Linux container)

`imgs/r4-*.png` come from a rebuilt full-stack rig (`harnesses-r4/`). The
bundled release CLI (`npm run build && npm run bundle`, then
`node dist/cli.js channel start dt`) runs inside a `--network none` container
whose `/etc/hosts` points `api.dingtalk.com` and `oapi.dingtalk.com` at
`127.0.0.1`. The rig serves the whole surface locally: `oapi/gettoken`, the
Stream gateway handshake, a WebSocket that pushes both inbound messages and
`/v1.0/card/instances/callback` card taps, the three Card OpenAPI endpoints,
`sessionWebhook`, the proactive robot-message endpoints, and an
OpenAI-compatible model endpoint that emits real `tool_calls`.

Whether the tool actually ran is decided by a filesystem sentinel the shell
tool appends to, never by a log line.

- `out-r4/*.json` — one record per container run: every Card OpenAPI request,
  every `cardParamMap`, every webhook/robot message body, the model call
  ledger and the sentinel contents.
- `harnesses-r4/mutants.py` — builds 11 mutant bundles by clone-and-patch of
  the head `dist/`, one reversed behaviour each; a patch that fails to apply
  is a hard error so an unapplied patch can never read as a survivor.

As in earlier rounds, the card pictures are the harness's rendering of the
captured `cardParamMap`, not screenshots of a DingTalk client.
