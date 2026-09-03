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

