import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs/promises';
import { logger, UdsClientTransport } from '@mako10k/shell-server/runtime';

class ReadBuffer {
  private buffer: Buffer | undefined;

  append(chunk: Buffer): void {
    this.buffer = this.buffer ? Buffer.concat([this.buffer, chunk]) : chunk;
  }

  readMessage(): JSONRPCMessage | null {
    if (!this.buffer) {
      return null;
    }

    const index = this.buffer.indexOf('\n');
    if (index === -1) {
      return null;
    }

    const line = this.buffer.toString('utf8', 0, index).replace(/\r$/, '');
    this.buffer = this.buffer.subarray(index + 1);
    return JSONRPCMessageSchema.parse(JSON.parse(line));
  }

  clear(): void {
    this.buffer = undefined;
  }
}

function serializeMessage(message: JSONRPCMessage): string {
  return `${JSON.stringify(message)}\n`;
}

const SOCKET_READY_TIMEOUT_MS = 3000;
const SOCKET_READY_INTERVAL_MS = 200;
const TRANSPORT_READY_TIMEOUT_MS = 2000;
const TRANSPORT_READY_INTERVAL_MS = 200;
const RECONNECT_BASE_DELAY_MS = 200;
const RECONNECT_MAX_DELAY_MS = 2000;
const MAX_QUEUED_MESSAGES = 200;

async function validateSocketPermissions(socketPath: string): Promise<void> {
  const stat = await fs.stat(socketPath);
  if (!stat.isSocket()) {
    throw new Error('Socket path is not a Unix domain socket.');
  }

  const mode = stat.mode & 0o777;
  if (mode !== 0o600) {
    throw new Error('Socket permissions must be 600.');
  }

  const getuid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (getuid !== null && stat.uid !== getuid) {
    throw new Error('Socket owner does not match current user.');
  }
}

async function waitForSocketReady(socketPath: string): Promise<void> {
  const deadline = Date.now() + SOCKET_READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      await validateSocketPermissions(socketPath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, SOCKET_READY_INTERVAL_MS));
  }

  throw new Error('Timed out waiting for daemon socket.');
}

export async function runDaemonProxy(socketPath: string): Promise<void> {
  const readBuffer = new ReadBuffer();
  const outboundQueue: JSONRPCMessage[] = [];
  let activeTransport: UdsClientTransport | null = null;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let reconnectAttempt = 0;
  let shuttingDown = false;

  const clearReconnectTimer = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
  };

  const closeActiveTransport = async () => {
    const transport = activeTransport;
    activeTransport = null;
    if (!transport) {
      return;
    }
    try {
      await transport.close();
    } catch (error) {
      logger.error('Failed to close daemon proxy transport', { error: String(error) }, 'daemon-proxy');
    }
  };

  const scheduleReconnect = (reason: string, error?: unknown) => {
    if (shuttingDown || reconnectTimer) {
      return;
    }

    reconnectAttempt += 1;
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * (2 ** (reconnectAttempt - 1)), RECONNECT_MAX_DELAY_MS);
    logger.warn(
      'Daemon transport disconnected; scheduling reconnect',
      { reason, delayMs: delay, reconnectAttempt, socketPath, error: error ? String(error) : undefined },
      'daemon-proxy'
    );

    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void connectTransport();
    }, delay);
  };

  const flushQueuedMessages = () => {
    if (!activeTransport || outboundQueue.length === 0) {
      return;
    }

    const pending = outboundQueue.splice(0, outboundQueue.length);
    for (const message of pending) {
      activeTransport.send(message).catch((error) => {
        logger.error('Failed to send queued daemon proxy message', { error: String(error) }, 'daemon-proxy');
      });
    }
  };

  const createTransport = (): UdsClientTransport => {
    const transport = new UdsClientTransport(socketPath);

    transport.onmessage = (message) => {
      try {
        const payload = serializeMessage(message as JSONRPCMessage);
        process.stdout.write(payload);
      } catch (error) {
        logger.error('Failed to write daemon message', { error: String(error) }, 'daemon-proxy');
      }
    };

    transport.onerror = (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      const message = (() => {
        if (code === 'ENOENT') {
          return 'Daemon socket not found. Start the shell-server daemon process.';
        }
        if (code === 'EACCES') {
          return 'Permission denied connecting to daemon socket. Check file permissions and ownership.';
        }
        if (code === 'ECONNREFUSED') {
          return 'Daemon socket refused connection. The daemon may be down.';
        }
        return 'Daemon transport error.';
      })();

      logger.error(
        message,
        { error: String(error), code, socketPath },
        'daemon-proxy'
      );
    };

    transport.onclose = () => {
      if (activeTransport === transport) {
        activeTransport = null;
      }
      if (shuttingDown) {
        return;
      }
      scheduleReconnect('transport_closed');
    };

    return transport;
  };

  const startTransport = async (transport: UdsClientTransport) => {
    const deadline = Date.now() + TRANSPORT_READY_TIMEOUT_MS;
    let lastError: unknown = null;

    while (Date.now() < deadline) {
      try {
        await transport.start();
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        lastError = error;
        if (code !== 'ECONNREFUSED') {
          throw error;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, TRANSPORT_READY_INTERVAL_MS));
    }

    throw lastError || new Error('Timed out waiting for daemon transport.');
  };

  const connectTransport = async () => {
    if (shuttingDown || activeTransport) {
      return;
    }

    try {
      await waitForSocketReady(socketPath);
      const transport = createTransport();
      await startTransport(transport);
      activeTransport = transport;
      reconnectAttempt = 0;
      flushQueuedMessages();
      logger.info('Daemon proxy transport connected', { socketPath }, 'daemon-proxy');
    } catch (error) {
      scheduleReconnect('connect_failed', error);
    }
  };

  const shutdown = async () => {
    shuttingDown = true;
    clearReconnectTimer();
    readBuffer.clear();
    await closeActiveTransport();
  };

  await connectTransport();

  process.stdin.on('data', (chunk) => {
    readBuffer.append(chunk);
    while (true) {
      let message: JSONRPCMessage | null = null;
      try {
        message = readBuffer.readMessage();
      } catch (error) {
        logger.error('Failed to parse daemon proxy message', { error: String(error) }, 'daemon-proxy');
        break;
      }

      if (!message) {
        break;
      }

      if (activeTransport) {
        activeTransport.send(message).catch((error) => {
          logger.error('Failed to send daemon proxy message', { error: String(error) }, 'daemon-proxy');
        });
      } else if (outboundQueue.length < MAX_QUEUED_MESSAGES) {
        outboundQueue.push(message);
      } else {
        logger.warn('Dropping daemon proxy message because outbound queue is full', { max: MAX_QUEUED_MESSAGES }, 'daemon-proxy');
      }
    }
  });

  process.stdin.on('close', () => {
    void shutdown().finally(() => {
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    void shutdown().finally(() => {
      process.exit(0);
    });
  });

  process.on('SIGTERM', () => {
    void shutdown().finally(() => {
      process.exit(0);
    });
  });
}
