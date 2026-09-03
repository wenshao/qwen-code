import subprocess, sys, os, json, re
SP=os.environ['SP']; PKG='/root/git/pr10893-pr/packages/channels/dingtalk'
F='src/outbound-file.ts'; A='src/DingtalkAdapter.ts'
M = [
 ('M1 drop O_NOFOLLOW on open', F, "constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0)", "constants.O_RDONLY | constants.O_NONBLOCK"),
 ('M2 size limit 20 MiB -> 40 MiB', F, "if (stats.size > MAX_FILE_BYTES) throw", "if (stats.size > MAX_FILE_BYTES * 2) throw"),
 ('M3 accept empty files', F, "if (stats.size === 0) throw new Error('File is empty');", "if (stats.size < 0) throw new Error('File is empty');"),
 ('M4 containment check always true', F, "  const child = relative(directory, filePath);\n  return (", "  const child = relative(directory, filePath);\n  return true || ("),
 ('M5 session file send follows redirects', A, "redirect: 'error',", "redirect: 'follow',"),
 ('M6 session webhook host allowlist removed', A, "ROBOT_MESSAGE_HOSTS.has(url.hostname)", "true"),
 ('M7 no token refresh retry on auth failure', A, "error.authFailure &&\n          attempt === 0", "error.authFailure &&\n          attempt === 99"),
 ('M8 pure-file reply still sends an empty markdown', A, "      : await this.prepareReplyOutput(chatId, text);\n    if (!outgoingText.trim()) return;", "      : await this.prepareReplyOutput(chatId, text);"),
 ('M9 no limit-exceeded notice', A, "if (projection.excessMarkers > 0) {", "if (projection.excessMarkers > 99) {"),
 ('M10 per-response file cap 5 -> 6', F, "export const MAX_FILES_PER_RESPONSE = 5;", "export const MAX_FILES_PER_RESPONSE = 6;"),
 ('M11 deliver files AFTER the status card finalizes (order swap)', A, "    const outgoingText = await this.prepareReplyOutput(chatId, text, streamed);\n    if (segment && this.interactionPresenter) {\n      if (\n        await this.interactionPresenter.closeOutput(\n          segment.segmentId,\n          outgoingText,\n          'completed',\n          segment,\n        )\n      ) {\n        return;\n      }\n    }", "    const projectedText = projectFileText(text).text;\n    if (segment && this.interactionPresenter) {\n      const closed = await this.interactionPresenter.closeOutput(\n          segment.segmentId,\n          projectedText,\n          'completed',\n          segment,\n        );\n      await this.prepareReplyOutput(chatId, text, streamed);\n      if (closed) return;\n    }\n    const outgoingText = await this.prepareReplyOutput(chatId, text, streamed);"),
 ('M12 proactive file: ignore missing processQueryKey (group)', A, "        if (\n          typeof data['processQueryKey'] !== 'string' ||\n          !data['processQueryKey'].trim()\n        ) {", "        if (false) {"),
 ('M13 access token not redacted from upload errors', F, "return (accessToken ? value.replaceAll(accessToken, '[redacted]') : value)", "return value"),
 ('M14 blockStreaming=on still delivers files', A, "      this.config.blockStreaming === 'on' &&\n      (projection.markerCount > 0 || streamedMarkers > 0)", "      false"),
]
orig = {F: open(os.path.join(PKG,F)).read(), A: open(os.path.join(PKG,A)).read()}
rows=[]
for name, f, old, new in M:
    src = orig[f]
    if src.count(old) != 1:
        rows.append((name, 'PATCH-MISS', f'count={src.count(old)}')); continue
    open(os.path.join(PKG,f),'w').write(src.replace(old,new))
    r = subprocess.run(['npx','vitest','run','src/outbound-file.test.ts','src/DingtalkAdapter.test.ts','--reporter=dot'], cwd=PKG, capture_output=True, text=True, env={**os.environ,'CI':'true','FORCE_COLOR':'0'})
    open(os.path.join(PKG,f),'w').write(src)
    out = r.stdout + r.stderr
    m = re.search(r'Tests\s+(?:(\d+) failed \| )?(\d+) passed', out)
    failed = int(m.group(1) or 0) if m else -1
    names = re.findall(r'(?:×|✗|FAIL)\s+(?:src/\S+ > )?([^\n]{0,110})', out)
    rows.append((name, 'KILLED' if r.returncode != 0 else 'SURVIVED', f'{failed} failing test(s)' + ('; e.g. ' + names[0].strip() if names else '')))
    print(f'{rows[-1][1]:9} {name}  :: {rows[-1][2]}', flush=True)
json.dump(rows, open(os.path.join(SP,'mut','results.json'),'w'), indent=1)
