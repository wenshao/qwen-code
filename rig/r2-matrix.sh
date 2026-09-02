#!/usr/bin/env bash
set -u
echo "=== node $(node --version) | $(uname -srm) | nproc $(nproc) ==="
# --- 1. the original property still holds at the new head -------------------
bash /rig/r2.sh A_before_lat03      before2 none none 0.3 mint 5
bash /rig/r2.sh B_after2_lat03      after2  none none 0.3 mint 5
bash /rig/r2.sh B_after2_clean      after2  none none 0   mint 5
# --- 2. script mutants: coverage witness survived the refactor? -------------
for m in failopen bareassign dieonskip; do
  bash /rig/r2.sh "S_after2_${m}"      after2 "$m" none 0   mint 2
  bash /rig/r2.sh "S_after2_${m}_lat"  after2 "$m" none 0.3 mint 2
done
# --- 3. is the >= 2 count still load-bearing at the new head? ---------------
bash /rig/r2.sh G_gate1_failopen_lat  after2 failopen gate_one 0.3 mint 3
bash /rig/r2.sh G_gate1_clean_lat     after2 none     gate_one 0.3 mint 3
# --- 4. is the NEW witness test a real witness? -----------------------------
bash /rig/r2.sh W_witness_clean       after2 none none          0 witness 3
bash /rig/r2.sh W_witness_msgbare     after2 none msg_bare      0 witness 2
bash /rig/r2.sh W_witness_nocount     after2 none msg_nocount   0 witness 2
bash /rig/r2.sh W_witness_nolastline  after2 none msg_nolastline 0 witness 2
# does the MINT test notice the message mutants at all? (expect: no)
bash /rig/r2.sh W_mint_msgbare        after2 none msg_bare      0 mint 2
