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

## Release

Stable release checklist (short version):

1. Update `CHANGELOG.md` (`[Unreleased]`) and split next version section.

```bash
npm run changelog:release -- <version>
```

2. Run pre-commit quality checks.

```bash
npm install
npm run build
npm audit
npm run test:e2e
```

3. Bump version (SemVer) without auto tag/commit.

```bash
npm version patch --no-git-tag-version
# or: npm version minor --no-git-tag-version
# or: npm version major --no-git-tag-version
```

4. Commit release changes and create annotated tag.

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore(release): <version>"
git tag -a v<version> -m "Release v<version>"
```

5. Push branch and tag.

```bash
git push origin main
git push origin v<version>
```

6. Publish package and update GitHub Release.

```bash
npm publish
gh release create v<version> --title "v<version>" --generate-notes
# if release already exists:
gh release edit v<version> --title "v<version>" --notes-file <release-note-file>
```

## Notes

- Runtime dependency: `@mako10k/shell-server` (recommended: `>=0.2.4`)
- External env interface keeps `MCP_SHELL_DEFAULT_WORKDIR` as primary.
- `SHELL_SERVER_DEFAULT_WORKDIR` is accepted as a compatibility alias.
- Allowed workdir list is provided by `SHELL_SERVER_ALLOWED_WORKDIRS`.
- This package follows shell-server v0.2.x child-daemon fields (`childSocketPath`/`child.sock`).
- `mcp-shell` no longer runs the MCP implementation in-process.
- It starts (or reuses) shell-server process via server manager and connects
  through daemon socket proxy.
