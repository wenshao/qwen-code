# Verification assets for QwenLM/qwen-code PR #10893

`imgs/` — screenshots embedded in the verification comment.
`harness/` — the local harness used for the run (spoofed DingTalk open API + stream gateway, scripted model, scenario drivers, mutation script). Certificates and captured logs are not included; generate a CA + a cert with `SAN=DNS:api.dingtalk.com,DNS:oapi.dingtalk.com` under `harness/certs/` and point `/etc/hosts` at 127.0.0.1 for both domains before running.
