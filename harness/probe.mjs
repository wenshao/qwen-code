/**
 * Round-2 verification probe for PR #9541.
 *
 * Drives the REAL compiled ChatCompressionService from this worktree's own
 * `packages/core/dist` against a mock provider that counts every request with
 * the REAL Qwen2.5 tokenizer and enforces `prompt + max_tokens <= window`.
 *
 * Usage: node probe.mjs <scenarioFile.json> <outFile.jsonl>
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

import {
  ChatCompressionService,
  COMPACT_MAX_OUTPUT_TOKENS,
  COMPACTION_BUDGET_SAFETY_MARGIN,
} from '@qwen-code/qwen-code-core/dist/src/services/chatCompressionService.js';
import { CompressionStatus, AuthType } from '@qwen-code/qwen-code-core';
import { estimateContentTokens } from '@qwen-code/qwen-code-core/dist/src/services/tokenEstimation.js';

const require = createRequire('/root/git/shared-node-deps/index.js');
const { fromPreTrained } = require('@lenml/tokenizer-qwen2_5');
const tokenizer = fromPreTrained();
const realTokens = (text) => tokenizer.encode(text).length;

const STATUS_NAME = Object.fromEntries(
  Object.entries(CompressionStatus)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => [v, k]),
);

// ---------------------------------------------------------------------------
// Corpora — real repository content, so the token ratios are not hand-tuned.
//   en-code : TypeScript sources (the dominant shape of a coding session)
//   zh-mixed: the repo's own Chinese design docs (~16% CJK by character)
//   zh-prose: dense Chinese conversation (a Chinese-speaking user chatting)
// ---------------------------------------------------------------------------
const REPO = process.cwd();
const readRepo = (rel) => readFileSync(`${REPO}/${rel}`, 'utf8');

const CORPUS_FILES = {
  'en-code': [
    'packages/core/src/services/chatCompressionService.ts',
    'packages/core/src/core/turn.ts',
    'packages/core/src/services/compactionInputSlimming.ts',
    'packages/core/src/services/microcompaction/microcompact.ts',
    'README.md',
  ],
  'zh-mixed': [
    'docs/design/ctrl-o-detail-expand/design.md',
    'docs/design/rt-optimization/rt-optimization-design.md',
    'docs/design/daemon-session-artifacts/session-artifacts-daemon-api-implementation-design.md',
    'docs/design/rt-optimization/reduce-rounds-via-skill-design.md',
    'docs/design/auto-memory/memory-system.md',
  ],
};

const ZH_PROSE = [
  '我们在重构上下文压缩模块，目标是让共享缓存请求和冷压缩请求都走同一套准入检查，避免把注定失败的请求发到服务端去。',
  '这一版实现里，估算函数会对非 ASCII 字符做额外的补偿，因为按字符数除以四的粗略估算在中文语料上会明显偏低，导致预算算错。',
  '需要注意的是压缩请求的输出预算必须从上下文窗口里预留出来，否则提供方会直接返回上下文超限错误，整轮对话就断了。',
  '在真实会话里，工具调用的结果往往占据了历史里最大的一部分，微压缩可以先清掉较早的工具结果再尝试压缩，这样成功率更高。',
  '如果本地估算过于保守，就会把原本能放进窗口的会话直接判定为无法压缩，用户既压缩不了也没法继续对话，体验反而更差。',
  '我们希望最终的行为是：能压缩的一定压缩，实在放不下的才在本地拒绝，并且给出明确的原因说明，让用户知道下一步该怎么办。',
  '这段历史里还包含了一些代码片段和英文术语，比如 tokenizer、context window、prompt cache，用来模拟真实的中英混排场景。',
  '压缩完成之后，会话会用一段结构化摘要替换掉旧历史，随后的对话继续在新的上下文里进行，摘要里保留目标、约束和未完成的工作。',
];

function corpusChunks(lang) {
  const chunks = [];
  if (lang === 'zh-prose') {
    for (let i = 0; i < 4000; i++) {
      chunks.push(
        Array.from({ length: 8 }, (_, k) => ZH_PROSE[(i + k) % ZH_PROSE.length]).join(''),
      );
    }
    return chunks;
  }
  const files = CORPUS_FILES[lang];
  if (!files) throw new Error(`unknown corpus ${lang}`);
  const text = files.map(readRepo).join('\n\n');
  const size = 2400;
  for (let round = 0; round < 40; round++) {
    // Vary the offset per round so repeated passes are not byte-identical.
    const offset = (round * 137) % size;
    for (let i = offset; i < text.length; i += size) {
      chunks.push(text.slice(i, i + size));
    }
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Estimator formulas (mirrors of production, cross-checked against the
// production warning text at runtime — see `estimatorSelfCheck` below).
// ---------------------------------------------------------------------------
const CHARS_PER_TOKEN = 4;
function utf8Expansion(text) {
  let bytes = 0;
  let units = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) continue;
    units += ch.length;
    bytes += cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
  }
  return bytes - units;
}
// PR head (7820a426e): base + ceil(expansion / 2)
const estimateHead = (text) =>
  Math.ceil(text.length / CHARS_PER_TOKEN) + Math.ceil(utf8Expansion(text) / 2);
// Round-1 head (17f8aae, as reported in the 2026-08-31 comment): base + utf8 bytes
function estimateRound1(text) {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) continue;
    bytes += cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
  }
  return Math.ceil(text.length / CHARS_PER_TOKEN) + bytes;
}
const estimateBase = (text) => Math.ceil(text.length / CHARS_PER_TOKEN);

// ---------------------------------------------------------------------------
// Session builders
// ---------------------------------------------------------------------------
function buildHistory({ lang, targetRealTokens, toolResults = 0 }) {
  const chunks = corpusChunks(lang);
  const history = [];
  let total = 0;
  let i = 0;
  for (let t = 0; t < toolResults; t++) {
    const output = [chunks[i++], chunks[i++], chunks[i++], chunks[i++]].join('\n');
    history.push({
      role: 'model',
      parts: [
        { functionCall: { name: 'read_file', args: { path: `file_${t}.md` } } },
      ],
    });
    history.push({
      role: 'user',
      parts: [
        { functionResponse: { name: 'read_file', response: { output } } },
      ],
    });
    total += realTokens(output);
  }
  while (total < targetRealTokens) {
    const userText = chunks[i++ % chunks.length];
    const modelText = [
      chunks[i++ % chunks.length],
      chunks[i++ % chunks.length],
      chunks[i++ % chunks.length],
    ].join('\n');
    if (userText === undefined || modelText === undefined) break;
    history.push({ role: 'user', parts: [{ text: userText }] });
    history.push({ role: 'model', parts: [{ text: modelText }] });
    total += realTokens(userText) + realTokens(modelText);
    if (i > 100000) break;
  }
  return { history, realHistoryTokens: total };
}

function collectRequestText(contents, systemInstruction) {
  const chunks = [];
  if (systemInstruction) chunks.push(String(systemInstruction));
  const walk = (part) => {
    if (!part || typeof part !== 'object') return;
    if (part.inlineData || part.fileData) {
      chunks.push('[[media]]');
      return;
    }
    if (typeof part.text === 'string') {
      chunks.push(part.text);
      if (typeof part.thoughtSignature === 'string')
        chunks.push(part.thoughtSignature);
      return;
    }
    if (part.functionResponse) {
      const out = part.functionResponse.response?.['output'];
      const err = part.functionResponse.response?.['error'];
      if (typeof out === 'string') chunks.push(out);
      else if (typeof err === 'string') chunks.push(err);
      for (const nested of part.functionResponse.parts ?? []) walk(nested);
      return;
    }
    chunks.push(JSON.stringify(part));
  };
  for (const content of contents ?? []) for (const p of content.parts ?? []) walk(p);
  return chunks.join('\n');
}

const SUMMARY_TEXT =
  '<state_snapshot><overall_goal>验证压缩准入</overall_goal><key_knowledge>压缩请求必须先通过准入检查</key_knowledge></state_snapshot>';

// ---------------------------------------------------------------------------
// Scenario runner
// ---------------------------------------------------------------------------
async function runScenario(sc) {
  const {
    name,
    lang = 'zh',
    window: contextWindow,
    utilization,
    toolResults = 0,
    cacheSharing = true,
    providerAnchor = 'provider', // 'provider' | 'estimated' | 'none'
    compactionModel,
    compactionWindow,
    sideQueryThrows = false,
    force = true,
    omitUsage = false,
    requestPayloadTooLarge = false,
    summaryLang,
    summaryChars = 0,
  } = sc;

  // Optional long summary in a chosen script, to exercise the summary-side
  // estimate (used when the provider omits usage metadata).
  const summaryBody =
    summaryChars > 0
      ? (summaryLang === 'zh'
          ? '这是一段结构化的会话摘要，记录了目标、约束、已完成的工作与下一步计划。'
          : 'This is a structured session summary recording goals, constraints, work done and next steps. '
        ).repeat(Math.ceil(summaryChars / 30)).slice(0, summaryChars)
      : '';
  const summaryText =
    summaryChars > 0
      ? `<state_snapshot><overall_goal>${summaryBody}</overall_goal></state_snapshot>`
      : SUMMARY_TEXT;

  const target = Math.round(contextWindow * utilization);
  const { history, realHistoryTokens } = buildHistory({
    lang,
    targetRealTokens: target,
    toolResults,
  });

  const mainSystemPrompt =
    'You are Qwen Code, an interactive CLI agent.\n'.repeat(60);
  const toolsSchema = [
    {
      functionDeclarations: Array.from({ length: 12 }, (_, i) => ({
        name: `tool_${i}`,
        description: 'A tool used by the agent to interact with the workspace.',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      })),
    },
  ];

  const requests = [];
  const debugLines = [];
  const providerRejects = [];

  const client = {
    async generateText(options) {
      const promptTokens = realTokens(
        collectRequestText(options.contents, options.systemInstruction),
      );
      const maxTokens = options.config?.maxOutputTokens ?? 0;
      const shared = options.promptCacheSharing === true;
      if (sideQueryThrows && !shared) {
        requests.push({ kind: 'cold', promptTokens, maxTokens, verdict: 'threw' });
        throw new Error('probe: injected side-query failure');
      }
      const accepted = promptTokens + maxTokens <= contextWindow;
      requests.push({
        kind: shared ? 'shared' : 'cold',
        promptTokens,
        maxTokens,
        verdict: accepted ? 'accepted' : 'rejected-400',
      });
      if (!accepted) {
        providerRejects.push({ promptTokens, maxTokens });
        const err = new Error(
          `400 Range of input length should be [1, ${contextWindow}] ` +
            `(prompt ${promptTokens} + max_tokens ${maxTokens})`,
        );
        err.status = 400;
        throw err;
      }
      // A real provider stops generating at max_tokens: a budget of 1 yields a
      // one-token "summary", which is exactly the #9455 failure mode.
      const summaryIds = tokenizer.encode(summaryText);
      const emitted = Math.max(0, Math.min(maxTokens, summaryIds.length));
      const text =
        emitted >= summaryIds.length
          ? summaryText
          : tokenizer.decode(summaryIds.slice(0, emitted));
      requests[requests.length - 1].outputTokens = emitted;
      requests[requests.length - 1].truncated = emitted < summaryIds.length;
      if (omitUsage) {
        return { text, hadToolCall: false };
      }
      return {
        text,
        hadToolCall: false,
        usage: {
          promptTokenCount: promptTokens,
          candidatesTokenCount: emitted,
          totalTokenCount: promptTokens + emitted,
          cachedContentTokenCount: shared ? promptTokens : 0,
        },
      };
    },
  };

  const config = {
    getChatCompression: () => undefined,
    getAutoCompactThreshold: () => undefined,
    getBaseLlmClient: () => client,
    getContentGeneratorConfig: () => ({
      authType: AuthType.QWEN_OAUTH,
      contextWindowSize: contextWindow,
      ...(cacheSharing ? {} : { enableCacheControl: false }),
    }),
    getHookSystem: () => undefined,
    getModel: () => 'qwen3-coder-plus',
    getCompactionModel: () => compactionModel,
    getFastModel: () => undefined,
    getAllConfiguredModels: () =>
      compactionModel && compactionWindow
        ? [{ id: compactionModel, contextWindowSize: compactionWindow }]
        : [],
    getApprovalMode: () => 'default',
    getDebugLogger: () => ({
      warn: (m) => debugLines.push(`WARN ${m}`),
      debug: (m) => debugLines.push(`DEBUG ${m}`),
      error: (m) => debugLines.push(`ERROR ${m}`),
      info: () => {},
      log: () => {},
    }),
    getTargetDir: () => '/tmp/probe-workspace',
    getProjectRoot: () => '/tmp/probe-workspace',
    getBackgroundTaskRegistry: () => undefined,
    getSessionId: () => 'probe-session',
    getTelemetryEnabled: () => false,
    getTelemetryLogPromptsEnabled: () => false,
    getUsageStatisticsEnabled: () => false,
    getTelemetryOtlpEndpoint: () => undefined,
    getDebugMode: () => false,
    getProxy: () => undefined,
    getGeminiClient: () => undefined,
    getWorkspaceContext: () => ({ getDirectories: () => [] }),
  };

  const anchor =
    providerAnchor === 'none'
      ? 0
      : realHistoryTokens + realTokens(mainSystemPrompt) + 2500;
  const chat = {
    getHistory: () => history,
    getHistoryShallow: () => history,
    appendSystemInstruction: () => {},
    setHistory: () => {},
    getLastPromptTokenCount: () => anchor,
    isLastPromptTokenCountEstimated: () => providerAnchor === 'estimated',
    getLastOutputTokenCount: () => 0,
    getGenerationConfig: () => ({
      systemInstruction: mainSystemPrompt,
      tools: toolsSchema,
    }),
  };

  const service = new ChatCompressionService();
  let result;
  let thrown;
  const startedAt = Date.now();
  try {
    result = await service.compress(chat, {
      promptId: 'probe',
      force,
      config,
      consecutiveFailures: 0,
      originalTokenCount: anchor,
      originalTokenCountIsEstimated: providerAnchor === 'estimated',
      ...(requestPayloadTooLarge ? { requestPayloadTooLarge: true } : {}),
    });
  } catch (err) {
    thrown = String(err?.message ?? err);
  }
  const elapsedMs = Date.now() - startedAt;

  const historyText = collectRequestText(history, '');
  const warning = result?.info?.warning;
  const estimatedFromWarning = warning
    ? Number((/estimated input ([\d,]+) tokens/.exec(warning)?.[1] ?? '').replace(/,/g, '')) ||
      undefined
    : undefined;

  return {
    scenario: name,
    lang,
    window: contextWindow,
    utilization,
    toolResults,
    cacheSharing,
    providerAnchor,
    realHistoryTokens,
    realHistoryPctOfWindow: +(realHistoryTokens / contextWindow).toFixed(3),
    historyChars: historyText.length,
    baseEstimate: estimateBase(historyText),
    headEstimate: estimateHead(historyText),
    round1Estimate: estimateRound1(historyText),
    status: result ? STATUS_NAME[result.info.compressionStatus] : undefined,
    thrown,
    requests,
    requestCount: requests.length,
    providerRejects: providerRejects.length,
    warning,
    estimatedFromWarning,
    newTokenCount: result?.info?.newTokenCount,
    summaryRealTokens: summaryChars > 0 ? realTokens(summaryText) : undefined,
    summaryChars: summaryChars > 0 ? summaryText.length : undefined,
    compressed: result?.newHistory ? result.newHistory.length : 0,
    elapsedMs,
    debugLines: debugLines.filter((l) =>
      /compression|compaction/i.test(l),
    ).slice(0, 8),
  };
}

const scenarios = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = [];
for (const sc of scenarios) {
  const res = await runScenario(sc);
  out.push(res);
  console.log(
    `[${process.env['ARM'] ?? '?'}] ${res.scenario}: status=${res.status ?? res.thrown} ` +
      `real=${res.realHistoryTokens} (${(res.realHistoryPctOfWindow * 100).toFixed(0)}% of ${res.window}) ` +
      `requests=${res.requestCount} rejects=${res.providerRejects}` +
      (res.estimatedFromWarning ? ` estimated=${res.estimatedFromWarning}` : ''),
  );
}
writeFileSync(process.argv[3], out.map((o) => JSON.stringify(o)).join('\n'));
console.log(`wrote ${process.argv[3]}`);
