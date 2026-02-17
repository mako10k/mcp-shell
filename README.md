# mcp-shell

MCP interface layer for shell-server. This package starts
`@mako10k/shell-server` as an external server process and proxies MCP
STDIO traffic to that process.

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

- Runtime dependency: `@mako10k/shell-server` (recommended: `>=0.1.2`)
- The immediate-exit issue at startup is resolved with `@mako10k/shell-server@0.1.2`.
- `mcp-shell` no longer runs the MCP implementation in-process.
- It starts (or reuses) shell-server process via server manager and connects
  through daemon socket proxy.
