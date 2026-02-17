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

- Runtime dependency: `@mako10k/shell-server` (recommended: `>=0.2.0`)
- External env interface keeps `MCP_SHELL_DEFAULT_WORKDIR` as primary.
- `SHELL_SERVER_DEFAULT_WORKDIR` is accepted as a compatibility alias.
- Allowed workdir list is provided by `SHELL_SERVER_ALLOWED_WORKDIRS`.
- This package follows shell-server v0.2.0 child-daemon fields (`childSocketPath`/`child.sock`).
- `mcp-shell` no longer runs the MCP implementation in-process.
- It starts (or reuses) shell-server process via server manager and connects
  through daemon socket proxy.
