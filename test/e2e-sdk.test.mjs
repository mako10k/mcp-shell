import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CreateMessageRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const serverEntry = path.resolve(projectRoot, 'dist/index.js');
const childDaemonEntry = path.resolve(projectRoot, 'dist/daemon.js');

function createClientTransport() {
  const env = {
    ...process.env,
    LOG_LEVEL: process.env.LOG_LEVEL || 'error',
    MCP_SHELL_DEFAULT_WORKDIR: projectRoot,
    SHELL_SERVER_CHILD_DAEMON_ENTRY: childDaemonEntry,
    SHELL_SERVER_BRANCH: 'e2e',
    SHELL_SERVER_ENHANCED_MODE: 'false',
    SHELL_SERVER_LLM_EVALUATION: 'false',
  };

  return new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    cwd: projectRoot,
    env,
    stderr: 'pipe',
  });
}

function createSamplingClientTransport() {
  const env = {
    ...process.env,
    LOG_LEVEL: process.env.LOG_LEVEL || 'error',
    MCP_SHELL_DEFAULT_WORKDIR: projectRoot,
    SHELL_SERVER_CHILD_DAEMON_ENTRY: childDaemonEntry,
    SHELL_SERVER_BRANCH: 's',
    SHELL_SERVER_ENHANCED_MODE: 'true',
    SHELL_SERVER_LLM_EVALUATION: 'true',
    MCP_SAMPLING_ENABLE_TOOLS: 'true',
  };

  return new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    cwd: projectRoot,
    env,
    stderr: 'pipe',
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callToolJson(client, name, args) {
  const callResult = await client.callTool({ name, arguments: args });
  if ('isError' in callResult) {
    assert.notEqual(callResult.isError, true);
  }
  assert.ok(Array.isArray(callResult.content));
  assert.ok(callResult.content.length > 0);
  const firstContent = callResult.content[0];
  assert.equal(firstContent.type, 'text');
  return JSON.parse(firstContent.text);
}

test('SDK E2E: listTools and call server_current', { concurrency: false }, async () => {
  const transport = createClientTransport();
  const client = new Client({ name: 'mcp-shell-e2e', version: '0.1.0' });

  await client.connect(transport);

  try {
    const toolsResult = await client.listTools();
    const toolNames = toolsResult.tools.map((tool) => tool.name);

    assert.ok(toolNames.includes('server_current'));
    assert.ok(toolNames.includes('process_get_execution'));

    const callResult = await client.callTool({
      name: 'server_current',
      arguments: {},
    });

    if ('isError' in callResult) {
      assert.notEqual(callResult.isError, true);
    }
    assert.ok(Array.isArray(callResult.content));
    assert.ok(callResult.content.length > 0);

    const firstContent = callResult.content[0];
    assert.equal(firstContent.type, 'text');

    const payload = JSON.parse(firstContent.text);
    assert.ok(payload === null || typeof payload === 'object');
  } finally {
    await client.close();
  }
});

test('SDK E2E: server_stop returns and restart changes daemon pid', { concurrency: false }, async () => {
  const transport1 = createClientTransport();
  const client1 = new Client({ name: 'mcp-shell-e2e-stop-check-1', version: '0.1.0' });
  await client1.connect(transport1);

  let serverId;
  let pidBefore;

  try {
    const started = await callToolJson(client1, 'server_start', {
      cwd: projectRoot,
      allow_existing: true,
    });
    serverId = started.serverId;
    assert.equal(typeof serverId, 'string');
    assert.ok(serverId.length > 0);

    const beforeInfo = await callToolJson(client1, 'server_get', {
      server_id: serverId,
    });
    pidBefore = beforeInfo?.pid;
    assert.equal(typeof pidBefore, 'number');

    const stopResult = await callToolJson(client1, 'server_stop', {
      server_id: serverId,
      force: true,
    });
    assert.equal(stopResult.ok, true);
  } finally {
    await client1.close();
  }

  await sleep(1500);

  const transport2 = createClientTransport();
  const client2 = new Client({ name: 'mcp-shell-e2e-stop-check-2', version: '0.1.0' });
  await client2.connect(transport2);

  try {
    const restarted = await callToolJson(client2, 'server_start', {
      cwd: projectRoot,
      allow_existing: true,
    });
    assert.equal(restarted.serverId, serverId);

    let pidAfter;
    for (let i = 0; i < 25; i += 1) {
      const afterInfo = await callToolJson(client2, 'server_get', {
        server_id: serverId,
      });
      if (typeof afterInfo?.pid === 'number') {
        pidAfter = afterInfo.pid;
      }
      if (typeof pidAfter === 'number' && pidAfter !== pidBefore) {
        break;
      }
      await sleep(200);
    }

    assert.equal(typeof pidAfter, 'number');
    assert.notEqual(pidAfter, pidBefore);
  } finally {
    await client2.close();
  }
});

test('SDK E2E: unknown tool returns error', { concurrency: false }, async () => {
  const transport = createClientTransport();
  const client = new Client({ name: 'mcp-shell-e2e', version: '0.1.0' });

  await client.connect(transport);

  try {
    await assert.rejects(async () => {
      await client.callTool({
        name: 'unknown_tool_for_e2e',
        arguments: {},
      });
    });
  } finally {
    await client.close();
  }
});

test('SDK E2E: shell_execute with sampling handler (fixed response)', { concurrency: false }, async () => {
  const transport = createSamplingClientTransport();
  const client = new Client(
    { name: 'mcp-shell-e2e-sampling', version: '0.1.0' },
    { capabilities: { sampling: { tools: {} } } }
  );

  client.setRequestHandler(CreateMessageRequestSchema, async () => ({
    model: 'e2e-fixed-model',
    role: 'assistant',
    stopReason: 'tool_calls',
    content: {
      type: 'text',
      text: JSON.stringify({
        tool_calls: [
          {
            id: 'call_e2e_sampling_1',
            type: 'function',
            function: {
              name: 'allow',
              arguments: JSON.stringify({
                reasoning: '$COMMAND is a safe test command for E2E validation.',
              }),
            },
          },
        ],
      }),
    },
  }));

  await client.connect(transport);

  try {
    const callResult = await client.callTool({
      name: 'shell_execute',
      arguments: {
        command: 'echo mcp-shell-sampling',
        execution_mode: 'foreground',
        timeout_seconds: 10,
      },
    });

    if ('isError' in callResult) {
      assert.notEqual(callResult.isError, true);
    }
    assert.ok(Array.isArray(callResult.content));
    assert.ok(callResult.content.length > 0);

    const firstContent = callResult.content[0];
    assert.equal(firstContent.type, 'text');

    const payload = JSON.parse(firstContent.text);
    assert.equal(typeof payload.execution_id, 'string');
    assert.ok(payload.execution_id.length > 0);
  } finally {
    await client.close();
  }
});

test('SDK E2E: shell_execute with native tool_use response', { concurrency: false }, async () => {
  const transport = createSamplingClientTransport();
  const client = new Client(
    { name: 'mcp-shell-e2e-sampling-native', version: '0.1.0' },
    { capabilities: { sampling: { tools: {} } } }
  );

  client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
    const hasTools = Array.isArray(request.params.tools) && request.params.tools.length > 0;
    assert.equal(hasTools, true);

    return {
      model: 'e2e-native-tooluse-model',
      role: 'assistant',
      stopReason: 'toolUse',
      content: [
        {
          type: 'tool_use',
          id: 'call_e2e_native_tooluse_1',
          name: 'allow',
          input: {
            reasoning: '$COMMAND is a safe test command for E2E validation.',
          },
        },
      ],
    };
  });

  await client.connect(transport);

  try {
    const callResult = await client.callTool({
      name: 'shell_execute',
      arguments: {
        command: 'echo mcp-shell-native-tooluse',
        execution_mode: 'foreground',
        timeout_seconds: 10,
      },
    });

    if ('isError' in callResult) {
      assert.notEqual(callResult.isError, true);
    }
    assert.ok(Array.isArray(callResult.content));
    assert.ok(callResult.content.length > 0);

    const firstContent = callResult.content[0];
    assert.equal(firstContent.type, 'text');

    const payload = JSON.parse(firstContent.text);
    assert.equal(typeof payload.execution_id, 'string');
    assert.ok(payload.execution_id.length > 0);
  } finally {
    await client.close();
  }
});
