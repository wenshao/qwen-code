// Real stdio MCP server for PR #13390 verification.
// Exposes tools whose input schemas carry long per-property descriptions,
// like real-world MCP servers (GitHub, Jira, ...). Code mode renders a
// binding's parameters as a TypeScript signature and drops those property
// descriptions, while `/context` measures each tool's full JSON schema, so
// such a server is what puts the MCP clamp in force.
// usage: node mcp-server.mjs <hitsFile>
import { Server } from '/root/verify/pr13390/head/node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js';
import { StdioServerTransport } from '/root/verify/pr13390/head/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '/root/verify/pr13390/head/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
import { appendFileSync } from 'node:fs';

const hits = process.argv[2];

const para = (topic, n) =>
  Array.from(
    { length: n },
    (_, i) =>
      `Clause ${i + 1} on ${topic}: values are matched case-insensitively against the tracker index, unknown values are rejected with a validation error, and an empty value means the filter is not applied.`,
  ).join(' ');

const prop = (topic, n) => ({ type: 'string', description: para(topic, n) });

// Tools of clearly different sizes, so per-row scaling is visible. The
// paragraph counts are multiplied by $MCP_SCALE (default 1).
const K = Number(process.env.MCP_SCALE || 1);
const TOOLS = [
  {
    name: 'search_issues',
    description: 'Search issues and pull requests in the tracker.',
    inputSchema: {
      type: 'object',
      properties: {
        query: prop('the free-text query', 6 * K),
        state: prop('the issue state', 5 * K),
        labels: prop('label filters', 5 * K),
        assignee: prop('assignee filters', 5 * K),
        author: prop('author filters', 5 * K),
        milestone: prop('milestone filters', 5 * K),
        sort: prop('sort order', 4 * K),
        cursor: prop('pagination cursors', 4 * K),
      },
      required: ['query'],
    },
  },
  {
    name: 'create_issue',
    description: 'Open a new issue in the tracker.',
    inputSchema: {
      type: 'object',
      properties: {
        title: prop('issue titles', 4 * K),
        body: prop('issue bodies', 4 * K),
        labels: prop('initial labels', 3 * K),
        assignees: prop('initial assignees', 3 * K),
      },
      required: ['title'],
    },
  },
  {
    name: 'list_comments',
    description: 'List the comments on an issue.',
    inputSchema: {
      type: 'object',
      properties: {
        issue: prop('issue numbers', 2 * K),
        since: prop('timestamps', 2 * K),
      },
      required: ['issue'],
    },
  },
  {
    name: 'get_status',
    description: 'Report tracker health.',
    inputSchema: {
      type: 'object',
      properties: { verbose: { type: 'boolean' } },
    },
  },
];

const server = new Server(
  { name: 'tracker', version: '1.0.0' },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (hits) {
    appendFileSync(
      hits,
      JSON.stringify({ name: req.params.name, args: req.params.arguments }) +
        '\n',
    );
  }
  return { content: [{ type: 'text', text: `ok:${req.params.name}` }] };
});
await server.connect(new StdioServerTransport());
