Verification evidence for QwenLM/qwen-code PR #9879 (fix(core): stop forcing DeepSeek temperature).

- 01-wire-matrix.png     — `temperature` observed on the wire, BASE vs HEAD, DeepSeek vs control model, self-hosted vs api.deepseek.com
- 02-body-diff.png       — unified diff of the two raw POST /v1/chat/completions bodies
- 03-tests-mutation.png  — provider+pipeline suite on HEAD, and the mutation that turns the new test red
- 04-tui-session.png     — interactive session driven end-to-end against a deepseek-v4-flash endpoint
