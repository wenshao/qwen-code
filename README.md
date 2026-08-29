Verification artefacts for QwenLM/qwen-code#10036.

- geo.png / geo.txt / sudoab.txt : wipe-geometry matrix, run against the byte-identical release.yml step
- mut.png / mutate2.txt / mutate4.txt : mutation probes against the new test coverage
- gha.png / gha.txt : excerpts from the real GitHub Actions runs on this fork
- restore-step.sh : the exact bytes of release.yml step "Restore workspace ownership" (sha256 d758a071...)
- probe-workflows/ : the generated probe workflows pushed to verify/pr10036-probe*
