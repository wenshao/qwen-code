# Verification assets for QwenLM/qwen-code#10947

Terminal captures from a local end-to-end verification of PR #10947
("fix(cli): OpenTUI transcript visibility for commands, /clear and steers").

Each PNG is a real PTY byte stream from the bundled CLI (`dist/cli.js`) replayed
through xterm.js, 100x40, GitHub-dark palette:

- `visibility-ab.png` — `/about` on main vs on the PR (OpenTUI renderer)
- `clear-ab.png` — `/clear` with a turn already on screen
- `negative-control.png` — the PR tree with only the `.bind(host)` hunk reverted
- `steer-ab.png` — a mid-turn steer typed twice
- `submit-prompt-ab.png` — a prompt-expanding command (`/probe`)
