# mcp-shell

MCP interface layer for shell-server. Provides the MCP server entrypoint,
CLI, and daemon proxy used by MCP clients.

## Install

```bash
npm install -g @mako10k/mcp-shell
```

Or run directly:

```bash
npx -y @mako10k/mcp-shell --help
```

## Build

```bash
npm install
npm run build
```

## Notes

This repo depends on shell-server for the shared runtime surface.
