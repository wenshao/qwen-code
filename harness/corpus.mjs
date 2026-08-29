/**
 * Hand-built corpus of heredoc-shaped shell commands.
 *
 * PAYLOAD is a harmless marker binary installed on the sandbox PATH. If bash
 * really executes it, the permission layer must not silently auto-approve the
 * command. A neutral name (rather than `rm`) keeps the run safe and keeps
 * dangerousRules.ts from interfering with what we are measuring.
 */
export const PAYLOAD = 'pwned';
const P = `${PAYLOAD} take-over`;

const hand = [
  // ── the shape reported in #9381 ─────────────────────────────────────────
  ['issue-9381', `python - <<'PY'\nimport os\nprint(os.getcwd())\nPY`],
  ['issue-9381-unquoted', `python - <<PY\nimport os\nprint(os.getcwd())\nPY`],
  ['cat-quoted-delim', `cat <<'EOF'\nplain data\nEOF`],
  ['cat-dquoted-delim', `cat <<"TAG"\nplain data\nTAG`],
  ['cat-dash-tabs', `python <<-PY\n\timport os\n\tPY\necho done`],
  ['tee-file', `tee out.txt <<'EOF'\nhello\nEOF`],
  ['head-heredoc', `head <<'EOF'\na\nb\nEOF`],
  ['python3-versioned', `python3 - <<'PY'\nprint(1)\nPY`],
  ['node-heredoc', `node - <<'JS'\nconsole.log(1)\nJS`],
  ['two-heredocs', `cat <<A <<B\nfirst\nA\nsecond\nB`],
  ['crlf', `python <<'PY'\r\nprint('ok')\r\nPY\r\necho done`],

  // ── shell-fed bodies: the body IS executed code ─────────────────────────
  ['bash-fed', `bash <<EOF\n${P}\nEOF`],
  ['sh-fed', `sh <<EOF\n${P}\nEOF`],
  ['bash-quoted-delim', `bash <<'EOF'\n${P}\nEOF`],
  ['bash-s-fed', `bash -s <<EOF\n${P}\nEOF`],
  ['sudo-bash-fed', `sudo bash <<EOF\n${P}\nEOF`],
  ['nice-bash-fed', `nice bash <<EOF\n${P}\nEOF`],
  ['quoted-bash-fed', `'bash' <<EOF\n${P}\nEOF`],
  ['env-assign-bash-fed', `FOO='a b' bash <<EOF\n${P}\nEOF`],
  ['busybox-sh-fed', `busybox sh <<EOF\n${P}\nEOF`],
  ['subshell-bash-fed', `(bash) <<EOF\n${P}\nEOF`],
  ['pipe-into-bash', `cat <<EOF | bash\n${P}\nEOF`],
  ['compound-and-bash', `cd /tmp && bash <<EOF\n${P}\nEOF`],
  ['bash-continuation', `bash \\\n<<EOF\n${P}\nEOF`],
  ['two-openers-second-shell', `cat <<A && bash <<B\ncat data\nA\n${P}\nB`],
  ['zsh-fed', `zsh <<EOF\n${P}\nEOF`],
  ['dash-fed', `dash <<EOF\n${P}\nEOF`],
  ['xargs-fed', `xargs -I{} sh -c {} <<EOF\n${P}\nEOF`],

  // ── receiver identity cannot be proven ──────────────────────────────────
  ['fn-redefined-receiver', `cat() { bash; }\ncat <<EOF\n${P}\nEOF`],
  ['fn-keyword-receiver', `function cat { bash; }\ncat <<EOF\n${P}\nEOF`],
  ['alias-receiver', `shopt -s expand_aliases\nalias cat=bash\ncat <<EOF\n${P}\nEOF`],
  ['path-assign-receiver', `PATH=/tmp/x cat <<EOF\n${P}\nEOF`],
  ['hash-p-receiver', `hash -p /tmp/evil cat\ncat <<EOF\n${P}\nEOF`],
  ['eval-defines-receiver', `eval 'cat() { sh; }'\ncat <<EOF\n${P}\nEOF`],
  ['dot-slash-receiver', `./cat <<EOF\n${P}\nEOF`],
  ['abs-path-receiver', `/bin/cat <<EOF\n${P}\nEOF`],
  ['command-prefix', `command cat <<EOF\n${P}\nEOF`],
  ['exec-prefix', `exec cat <<EOF\n${P}\nEOF`],

  // ── phantom heredocs: << that is not an opener ──────────────────────────
  ['arith-shift-double-paren', `echo $((1 << 20))\n${P}\n20`],
  ['arith-shift-bracket', `echo $[1 << 5]\n${P}\nEOF`],
  ['param-expansion-default', `echo \${x:-<<EOF}\n${P}\nEOF`],
  ['comment-heredoc', `echo hi # <<EOF\n${P}\nEOF`],
  ['delim-with-expansion', `cat <<EOF$D\n${P}\nEOF`],
  ['punctuated-delim', `cat <<A,B\n${P}\nA,B`],
  ['numeric-delim', `cat <<123\n${P}\n123`],
  ['herestring', `cat <<<hi\n${P}`],

  // ── quoting across physical lines ───────────────────────────────────────
  ['multiline-dquote-arg', `echo "start\n<<EOF\n${P}\nEOF\nend"`],
  ['multiline-dquote-then-exec', `echo "start\ncat <<EOF\n"\n${P}\nEOF`],
  ['python-c-multiline', `python -c "\nx = 1 << 2\nprint(x)\n"`],
  ['squote-tail-then-op', `cat <<<hi\necho 'a\nb' && ${P}`],
  ['child-quote-leak', `bash <<EOF\ncat <<INNER\necho "\nEOF\n${P}`],
  ['child-quote-leak-2', `bash <<EOF\necho "\nEOF\n${P}`],

  // ── command substitution / continuation inside a body ───────────────────
  ['cmdsubst-in-body', `cat <<EOF\n$(${P})\nEOF`],
  ['backtick-in-body', `cat <<EOF\n\`${P}\`\nEOF`],
  ['cmdsubst-quoted-delim-inert', `cat <<'EOF'\n$(${P})\nEOF`],
  ['backslash-splice-body', `cat <<EOF\n$\\\n(id)\nEOF`],
  ['backslash-term-splice', `cat <<EOF\nfoo\\\nEOF\n${P}\nEOF`],

  // ── compound openers / operators sharing the opener line ────────────────
  ['opener-shares-and', `cat <<EOF && echo hi\nbody; with && ops\nEOF\necho done`],
  ['opener-shares-and-payload', `cat <<EOF && ${P}\nbody\nEOF`],
  ['opener-shares-semicolon', `cat <<EOF; ${P}\nbody\nEOF`],
  ['opener-in-subshell', `(cat <<EOF\nbody\nEOF\n)\n${P}`],
  ['opener-then-payload-line', `cat <<'EOF'\nbody\nEOF\n${P}`],
  ['opener-unterminated', `cat <<EOF\nbody\n${P}`],
  ['opener-backslash-continued', `cat <<EOF \\\n&& ${P}\nbody\nEOF`],

  // ── mid-word hash, tabs, whitespace variants ────────────────────────────
  ['midword-hash', `cat foo#bar <<EOF\nbody\nEOF\n${P}`],
  ['space-before-delim', `cat << EOF\nbody\nEOF\n${P}`],
  ['tab-strip-payload', `cat <<-EOF\n\tbody\n\tEOF\n${P}`],
  ['tab-strip-terminator-untabbed', `cat <<-EOF\n\tbody\nEOF\n${P}`],

  // ── plain (non-heredoc) controls ────────────────────────────────────────
  ['plain-payload', `${P}`],
  ['plain-and-chain', `echo hi && ${P}`],
  ['plain-newline-chain', `echo hi\n${P}`],
  ['plain-python', `python -c "print(1)"`],
  ['plain-cat', `cat README.md`],
];

// Systematic sweep: receiver x delimiter spelling x payload placement.
const receivers = ['cat', 'python', 'bash', 'sh', 'tee', 'head', 'node', 'perl', 'awk', 'ruby'];
const delims = [
  ['<<EOF', 'EOF'], ["<<'EOF'", 'EOF'], ['<<"EOF"', 'EOF'], ['<<-EOF', 'EOF'],
  ['<< EOF', 'EOF'], ['<<E_1', 'E_1'], ['<<_x', '_x'],
];
const tails = ['', `\n${P}`, '\necho tail'];
const sweep = [];
let sweepIndex = 0;
for (const r of receivers) {
  for (const [op, d] of delims) {
    for (const t of tails) {
      const body = ['python', 'node', 'ruby', 'perl'].includes(r) ? 'print(1)' : P;
      // The index keeps ids unique: several delimiter spellings sanitise to
      // the same slug, and a colliding id silently mis-joins ground truth to
      // the wrong command.
      sweep.push([
        `sweep-${sweepIndex++}-${r}-${t ? (t.includes(PAYLOAD) ? 'tailp' : 'tail') : 'notail'}`,
        `${r} ${op}\n${body}\n${d}${t}`,
      ]);
    }
  }
}

export const CORPUS = [...hand, ...sweep].map(([id, command]) => ({ id, command }));
