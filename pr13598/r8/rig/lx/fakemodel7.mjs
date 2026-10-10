// ../pr13550-rig/linux/fakemodel.mts
import { appendFileSync } from "node:fs";
import { createServer as createServer2 } from "node:http";

// integration-tests/fake-openai-server.ts
import {
  createServer
} from "node:http";
import { randomUUID } from "node:crypto";
var MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;
var RequestBodyTooLargeError = class extends Error {
  constructor() {
    super("fake OpenAI request body too large");
  }
};
function fakeToolCall(name, args, id = `call_${randomUUID()}`) {
  return {
    id,
    type: "function",
    function: {
      name,
      arguments: JSON.stringify(args)
    }
  };
}
async function startFakeOpenAIServer(handler, options = {}) {
  const requests = [];
  const server2 = createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    try {
      const rawBody = await readRequestBody(req);
      const body = parseJsonBody(rawBody);
      if (!body) {
        res.writeHead(400);
        res.end("bad json");
        return;
      }
      const requestIndex = requests.length;
      requests.push({ body, headers: req.headers });
      const response = await handler({ body, requestIndex });
      if (body["stream"] === true) {
        await writeStreamed(
          res,
          getModel(body),
          response,
          options.keepAlive !== false
        );
      } else {
        writeNonStreamed(
          res,
          getModel(body),
          response,
          options.keepAlive !== false
        );
      }
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        res.writeHead(413);
        res.end("request body too large");
        return;
      }
      if (res.headersSent) {
        if (!res.writableEnded) {
          res.destroy();
        }
        return;
      }
      res.writeHead(500, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: "fake OpenAI server handler failed",
            type: "server_error"
          }
        })
      );
    }
  });
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server2.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server2.off("error", onError);
      resolve();
    };
    server2.once("error", onError);
    server2.once("listening", onListening);
    server2.listen(Number(process.env.FAKE_PORT ?? 0), options.listenHost ?? "127.0.0.1");
  });
  const address = server2.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to start fake OpenAI server");
  }
  let closePromise;
  return {
    baseUrl: `http://${options.baseUrlHost ?? "127.0.0.1"}:${address.port}/v1`,
    requests,
    close: () => closePromise ??= closeServer(server2)
  };
}
function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalLength = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      totalLength += chunk.length;
      if (totalLength > MAX_REQUEST_BODY_BYTES) {
        tooLarge = true;
        reject(new RequestBodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}
function parseJsonBody(rawBody) {
  try {
    const parsed = JSON.parse(rawBody);
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function isJsonObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function getModel(body) {
  return typeof body["model"] === "string" ? body["model"] : "fake-model";
}
function writeNonStreamed(res, model, message, keepAlive) {
  res.writeHead(
    200,
    keepAlive ? { "content-type": "application/json" } : { connection: "close", "content-type": "application/json" }
  );
  res.end(
    JSON.stringify({
      id: chatCompletionId(),
      object: "chat.completion",
      created: nowSeconds(),
      model: message.model ?? model,
      choices: responseChoices(message).map((choice) => ({
        index: choice.index,
        message: {
          role: "assistant",
          content: choice.content ?? choice.contentChunks?.join("") ?? null,
          ...choiceReasoning(choice) ? { reasoning_content: choiceReasoning(choice) } : {},
          ...choice.toolCalls ? { tool_calls: choice.toolCalls } : {}
        },
        finish_reason: finishReason(choice)
      })),
      usage: message.usage ?? DEFAULT_USAGE
    })
  );
}
async function writeStreamed(res, model, message, keepAlive) {
  res.writeHead(200, {
    "cache-control": "no-cache",
    connection: keepAlive ? "keep-alive" : "close",
    "content-type": "text/event-stream"
  });
  const id = chatCompletionId();
  const created = nowSeconds();
  const responseModel = message.model ?? model;
  const chunk = (index, delta, finish_reason = null, usage) => ({
    id,
    object: "chat.completion.chunk",
    created,
    model: responseModel,
    choices: [{ index, delta, finish_reason }],
    ...usage ? { usage } : {}
  });
  const send = (payload, callback) => {
    res.write(`data: ${JSON.stringify(payload)}

`, callback);
  };
  const holdAfterChunks = message.holdAfterChunks ?? -1;
  let contentDeltas = 0;
  const sendContent = async (choiceIndex, content) => {
    send(chunk(choiceIndex, { content }));
    contentDeltas += 1;
    if (contentDeltas === holdAfterChunks) await message.holdUntil;
  };
  const choices = responseChoices(message);
  for (const [choicePosition, choice] of choices.entries()) {
    send(chunk(choice.index, { role: "assistant" }));
    if (choice.errorContent !== void 0) {
      send(
        chunk(choice.index, { content: choice.errorContent }, "error_finish")
      );
      continue;
    }
    for (const reasoning of choice.reasoningChunks ?? (choice.reasoning ? [choice.reasoning] : [])) {
      send(chunk(choice.index, { reasoning_content: reasoning }));
    }
    for (const [contentIndex, content] of (choice.contentChunks ?? []).entries()) {
      if (message.disconnectAfterContentChunks === contentIndex + 1) {
        send(chunk(choice.index, { content }), () => res.destroy());
        return;
      }
      await sendContent(choice.index, content);
    }
    if (!choice.contentChunks && choice.content) {
      await sendContent(choice.index, choice.content);
    }
    for (const [toolIndex, toolCall] of (choice.toolCalls ?? []).entries()) {
      send(
        chunk(choice.index, {
          tool_calls: [
            {
              index: toolIndex,
              id: toolCall.id,
              type: toolCall.type,
              function: {
                name: toolCall.function.name,
                arguments: ""
              }
            }
          ]
        })
      );
      if (toolCall.function.arguments) {
        send(
          chunk(choice.index, {
            tool_calls: [
              {
                index: toolIndex,
                function: {
                  arguments: toolCall.function.arguments
                }
              }
            ]
          })
        );
      }
    }
    send(
      chunk(
        choice.index,
        {},
        finishReason(choice),
        choices.length === 1 && choicePosition === choices.length - 1 ? message.usage ?? DEFAULT_USAGE : void 0
      )
    );
  }
  if (choices.length > 1) {
    send({
      id,
      object: "chat.completion.chunk",
      created,
      model: responseModel,
      choices: [],
      usage: message.usage ?? DEFAULT_USAGE
    });
  }
  res.write("data: [DONE]\n\n");
  res.end();
}
function responseChoices(message) {
  return message.choices ?? [
    {
      index: 0,
      content: message.content,
      contentChunks: message.contentChunks,
      reasoning: message.reasoning,
      reasoningChunks: message.reasoningChunks,
      errorContent: message.errorContent,
      toolCalls: message.toolCalls,
      finishReason: message.finishReason
    }
  ];
}
function choiceReasoning(choice) {
  return choice.reasoningChunks?.join("") ?? choice.reasoning;
}
function finishReason(message) {
  return message.finishReason ?? (message.toolCalls ? "tool_calls" : "stop");
}
var DEFAULT_USAGE = {
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0
};
function chatCompletionId() {
  return `chatcmpl-${randomUUID()}`;
}
function nowSeconds() {
  return Math.floor(Date.now() / 1e3);
}
function closeServer(server2) {
  return new Promise((resolve, reject) => {
    server2.close((error) => error ? reject(error) : resolve());
    server2.closeAllConnections();
  });
}

// ../pr13550-rig/linux/fakemodel.mts
var LOG = "/rig/runs/model-requests.jsonl";
var holds = /* @__PURE__ */ new Map();
function hold(id) {
  let entry = holds.get(id);
  if (!entry) {
    let release;
    const promise = new Promise((resolve) => release = resolve);
    entry = { promise, release };
    holds.set(id, entry);
  }
  return entry;
}
function text(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content.map((p) => typeof p === "object" && p && "text" in p ? String(p.text) : "").join("");
  return "";
}

// PR 13598 round 6, Linux durable rig: a scripted model. A prompt carrying TOOL:: gets one read_file
// call; the answer to a tool result is "DONE <first line>"; anything else answers PONG. Every request
// is logged with its message roles and rig markers.
const LOG5 = "/rig/runs/model-requests.jsonl";
var server = await startFakeOpenAIServer(
  async ({ body, requestIndex }) => {
    const messages = body["messages"] ?? [];
    const last = messages[messages.length - 1];
    const users = messages.filter((m) => m.role === "user").map((m) => text(m.content));
    const lastUser = users[users.length - 1] ?? "";
    let reply;
    if (last?.role === "tool") reply = { content: "DONE " + text(last.content).split("\n")[0].slice(0, 80) };
    else if (/SHELLBG::/.test(lastUser)) reply = { toolCalls: [fakeToolCall("run_shell_command", { command: "echo SHELL-BG-OK; head -1 notes/status.txt; head -c 3000000 /dev/zero | tr '\\0' x; echo; sleep 3; echo SHELL-BG-END", description: "background beacon", is_background: true }, `call_${requestIndex}_${Date.now()}`)] };
    else if (/SHELL::/.test(lastUser)) reply = { toolCalls: [fakeToolCall("run_shell_command", { command: "echo SHELL-OK; head -1 notes/status.txt", description: "print the beacon" }, `call_${requestIndex}_${Date.now()}`)] };
    else if (/TOOL::/.test(lastUser)) reply = { toolCalls: [fakeToolCall("read_file", { file_path: "notes/status.txt" }, `call_${requestIndex}_${Date.now()}`)] };
    else reply = { content: "PONG" };
    appendFileSync(LOG5, JSON.stringify({
      t: new Date().toISOString(), i: requestIndex, n: messages.length,
      roles: messages.map((m) => m.role[0] + (m.tool_calls ? `(${m.tool_calls.length})` : "")).join(""),
      markers: users.map((u) => (u.match(/(AUTO|USER|MANUAL)::[A-Za-z0-9_-]+|Occurrence: \S+/g) ?? []).join("+")),
      reply: reply.content ?? reply.toolCalls.map((c) => c.function.name + c.function.arguments).join(","),
    }) + "\n");
    return reply;
  },
  { listenHost: "127.0.0.1", baseUrlHost: "127.0.0.1", keepAlive: false }
);
console.log(`MODEL ${server.baseUrl}`);
