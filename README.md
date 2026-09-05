# Verification assets for QwenLM/qwen-code#11120

Screenshots produced while locally verifying PR #11120
(`fix(serve): bound and diagnose a session reclaim that can never succeed`)
at head `24da92033011adcc5ca2335ee45a8547aa56d828`, against its merge base
`419e8d57b2a9f9312b7d2955932e25c0d1cfc306`.

| file | what it shows |
| - | - |
| `imgs/01-ab-reaper-loop.png` | one un-settleable session on two real `qwen serve` daemons, same 410 s window |
| `imgs/02-cpu-burn.png` | the settle-wait spin, reproduced and measured in CPU terms |
| `imgs/03-mutation-matrix.png` | six mutations of the new production behaviour, five killed, one survivor |
| `imgs/04-recovery-delay.png` | what the backoff costs once the wedge clears, on both automatic close paths |
| `imgs/05-anti-stranding.png` | why the anti-stranding guarantee cannot be shown end to end |
