#!/usr/bin/env node

import { runDaemonProxy } from './daemon-proxy.js';
import { createServerManager, logger } from '@mako10k/shell-server/runtime';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const CHILD_SOCKET_INFO_TIMEOUT_MS = 5000;
const CHILD_SOCKET_INFO_INTERVAL_MS = 200;

function firstExistingPath(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function configureDaemonEntryDefaults(): void {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));

  if (!process.env['SHELL_SERVER_DAEMON_ENTRY']) {
    const daemonCandidates = [
      // 1) Mono-repo sibling package (preferred in local development)
      path.resolve(moduleDir, '../../shell-server/dist/daemon/server.js'),
      // 2) Installed dependency under this package
      path.resolve(moduleDir, '../node_modules/@mako10k/shell-server/dist/daemon/server.js'),
    ];
    const resolvedDaemonEntry = firstExistingPath(daemonCandidates);
    if (resolvedDaemonEntry) {
      process.env['SHELL_SERVER_DAEMON_ENTRY'] = resolvedDaemonEntry;
    } else {
      logger.warn(
        'No default shell-server daemon entry was resolved. Set SHELL_SERVER_DAEMON_ENTRY explicitly if startup fails.',
        { daemonCandidates },
        'main'
      );
    }
  }

  if (!process.env['SHELL_SERVER_CHILD_DAEMON_ENTRY']) {
    const childDaemonCandidates = [
      // Local/package runtime: dist/index.js and dist/daemon.js are siblings.
      path.resolve(moduleDir, 'daemon.js'),
      // Fallback for workspace execution from package root.
      path.resolve(process.cwd(), 'dist/daemon.js'),
    ];
    const resolvedChildDaemonEntry = firstExistingPath(childDaemonCandidates);
    if (resolvedChildDaemonEntry) {
      process.env['SHELL_SERVER_CHILD_DAEMON_ENTRY'] = resolvedChildDaemonEntry;
    } else {
      logger.warn(
        'No default child daemon entry was resolved. Set SHELL_SERVER_CHILD_DAEMON_ENTRY explicitly if startup fails.',
        { childDaemonCandidates },
        'main'
      );
    }
  }
}

async function getVersion(): Promise<string> {
  // Prefer reading from package.json near dist/index.js
  try {
    const packageJsonUrl = new URL('../package.json', import.meta.url);
    const pkgPath = packageJsonUrl.protocol === 'file:' ? packageJsonUrl : undefined;
    if (pkgPath) {
      const filePath = pkgPath.pathname;
      const json = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(json);
      if (typeof data.version === 'string') return data.version;
    }
  } catch {
    // ignore
  }
  // Fallback to npm-provided env when available
  if (process.env['npm_package_version']) return String(process.env['npm_package_version']);
  return 'unknown';
}

function printHelp(version: string): void {
  const lines = [
    `MCP Shell Server v${version}`,
    '',
    'Usage: mcp-shell [options]',
    '',
    'Options:',
    '  -h, --help           Show this help and exit',
    '  -v, --version        Show version and exit',
    '  --daemon             Kept for compatibility (default behavior)',
    '',
    'Environment variables:',
    '  BACKOFFICE_ENABLED=true   Start localhost-only Backoffice UI (default: disabled)',
    '  BACKOFFICE_PORT=3030      Backoffice UI port (listens on 127.0.0.1)',
    '  EXECUTION_BACKEND=local|remote  Select execution backend (default: local)',
    '  EXECUTOR_URL / EXECUTOR_HOST / EXECUTOR_PORT / EXECUTOR_TOKEN  Configure remote executor',
    '  MCP_SHELL_DEFAULT_WORKDIR  Default working directory for shell_execute',
    '  SHELL_SERVER_DEFAULT_WORKDIR  Compatible alias for default working directory',
    '  SHELL_SERVER_ALLOWED_WORKDIRS  Comma-separated allowed directories',
    '  MCP_DISABLED_TOOLS         Comma-separated tool names to disable',
    '  LOG_LEVEL=debug|info|warn|error  Log verbosity',
    '',
    'Related commands (from package scripts):',
    '  npm run backoffice:start   Start Backoffice UI only',
    '  npm run executor:start     Start standalone executor backend',
    '',
    'Notes:',
    '  This command runs MCP over STDIO and proxies to an external shell-server process.',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

async function main() {
  // Lightweight CLI arg parsing (before starting the server)
  const argv = process.argv.slice(2);
  if (argv.includes('--version') || argv.includes('-v')) {
    const ver = await getVersion();
    process.stdout.write(ver + '\n');
    return;
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    const ver = await getVersion();
    printHelp(ver);
    return;
  }

  try {
    configureDaemonEntryDefaults();

    const cliDaemon = argv.includes('--daemon');
    if (cliDaemon) {
      logger.info('`--daemon` is enabled (default behavior).', {}, 'main');
    }

    const serverManager = createServerManager();
    const cwd = process.env['MCP_SHELL_DEFAULT_WORKDIR'] || process.env['SHELL_SERVER_DEFAULT_WORKDIR'] || process.cwd();
    const started = await serverManager.start({ cwd, allowExisting: true });

    const resolveChildSocketPath = async (serverId: string): Promise<string | undefined> => {
      const deadline = Date.now() + CHILD_SOCKET_INFO_TIMEOUT_MS;

      while (Date.now() <= deadline) {
        const info = await serverManager.get({ serverId });
        const socketPath =
          info && typeof info === 'object' && 'childSocketPath' in info
            ? (info as { childSocketPath?: string }).childSocketPath
            : undefined;

        if (socketPath) {
          return socketPath;
        }

        await new Promise((resolve) => setTimeout(resolve, CHILD_SOCKET_INFO_INTERVAL_MS));
      }

      return undefined;
    };

    let socketPath = await resolveChildSocketPath(started.serverId);

    if (!socketPath) {
      await serverManager.stop({ serverId: started.serverId, force: true });
      const restarted = await serverManager.start({ cwd, allowExisting: false });
      socketPath = await resolveChildSocketPath(restarted.serverId);
    }

    if (!socketPath) {
      throw new Error('Child daemon socket was not available from shell-server process.');
    }

    await runDaemonProxy(socketPath);
  } catch (error) {
    logger.error('Failed to start shell-server process for MCP proxy', { error: String(error) }, 'main');
    process.exit(1);
  }
}

// メイン実行時の判定 - 常に実行（ライブラリとして使用される場合は除く）
main().catch((error) => {
  // console.error('Fatal error:', error);
  logger.error('Fatal error', { error: String(error) }, 'main');
  process.exit(1);
});
