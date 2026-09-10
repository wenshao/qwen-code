/**
 * Estimator calibration: the PR-head admission estimate vs the real Qwen2.5
 * tokenizer, per script. Run from the AFTER worktree root.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire('/root/git/shared-node-deps/index.js');
const { fromPreTrained } = require('@lenml/tokenizer-qwen2_5');
const tk = fromPreTrained();
const real = (s) => tk.encode(s).length;

const CHARS_PER_TOKEN = 4;
const expansion = (text) => {
  let bytes = 0;
  let units = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) continue;
    units += ch.length;
    bytes += cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
  }
  return { bytes, units };
};
const base = (t) => Math.ceil(t.length / CHARS_PER_TOKEN);
const head = (t) => {
  const { bytes, units } = expansion(t);
  return base(t) + Math.ceil((bytes - units) / 2);
};
const round1 = (t) => base(t) + expansion(t).bytes;

const samples = {
  'zh (prose)':
    '我们在重构上下文压缩模块，目标是让共享缓存请求和冷压缩请求都走同一套准入检查，避免把注定失败的请求发到服务端。压缩请求的输出预算必须从上下文窗口里预留出来，否则提供方会直接返回上下文超限错误。'.repeat(
      40,
    ),
  'zh (repo design doc)': readFileSync(
    `${process.cwd()}/docs/design/ctrl-o-detail-expand/design.md`,
    'utf8',
  ),
  'ja': 'コンテキスト圧縮の受け入れ判定を共有キャッシュ経路とコールド経路で統一し、失敗が確実なリクエストを送らないようにしています。出力予算をウィンドウから確保しないと、プロバイダはコンテキスト長超過のエラーを返します。'.repeat(
    40,
  ),
  'ko': '컨텍스트 압축 요청의 승인 검사를 공유 캐시 경로와 콜드 경로에서 동일하게 적용하도록 수정하고 있습니다. 출력 예산을 윈도우에서 확보하지 않으면 제공자는 컨텍스트 길이 초과 오류를 반환합니다.'.repeat(
    40,
  ),
  'ru': 'Мы переделываем допуск запросов сжатия так, чтобы общий кэш и холодный путь использовали одну и ту же проверку. Бюджет вывода необходимо резервировать из окна контекста, иначе провайдер вернёт ошибку.'.repeat(
    40,
  ),
  'emoji': '🚀🔥✅🧠📦🌏🙌🎯'.repeat(400),
  'en (prose, README)': readFileSync(`${process.cwd()}/README.md`, 'utf8'),
  'en (TypeScript source)': readFileSync(
    `${process.cwd()}/packages/core/src/services/chatCompressionService.ts`,
    'utf8',
  ),
};

const rows = [];
for (const [name, text] of Object.entries(samples)) {
  const r = real(text);
  rows.push({
    corpus: name,
    chars: text.length,
    realTokens: r,
    charsPerRealToken: +(text.length / r).toFixed(2),
    baseEstimate: base(text),
    baseRatio: +(base(text) / r).toFixed(2),
    headEstimate: head(text),
    headRatio: +(head(text) / r).toFixed(2),
    round1Estimate: round1(text),
    round1Ratio: +(round1(text) / r).toFixed(2),
  });
}
console.table(rows);
writeFileSync(process.argv[2], JSON.stringify(rows, null, 2));
