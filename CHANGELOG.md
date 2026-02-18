# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added
- Features added in MCP interface / daemon proxy / tool bridge

### Changed
- Changes to existing behavior (explicitly note compatibility impact when applicable)

### Fixed
- Bug fixes (briefly note reproduction conditions and impact scope)

### Security
- Security-related fixes and evaluation rule updates

### Dependencies
- Major dependency updates (include rationale when applicable)

### Notes
- Release notes and supplements (migration steps, known limitations, etc.)

## [0.1.1] - 2026-02-18

### Changed
- Updated runtime dependency `@mako10k/shell-server` to `^0.2.4`.
- Upgraded `@modelcontextprotocol/sdk` to `^1.26.0` and aligned MCP capability registration with the newer SDK API.
- Added release operation docs and changelog automation script, following the same release policy as `shell-server`.

### Security
- Resolved previously reported npm audit findings by aligning dependency versions with vulnerability-fixed releases.

## [0.1.0] - 2026-02-17

### Added
- Initial npm release of `@mako10k/mcp-shell`.
