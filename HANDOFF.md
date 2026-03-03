# HANDOFF (2026-03-03)

## Scope Completed Today
- Investigated persistent live `shell_execute` deny path in enhanced evaluator.
- Hardened sampling compatibility bridge in `mcp-shell` for fallback scenarios.
- Added and validated E2E coverage for retry/fallback behavior.

## Code Changes

### 1) Daemon proxy fail-fast on transport loss
- File: `src/daemon-proxy.ts`
- Change:
  - Removed outbound queue buffering while transport is unavailable.
  - Added immediate JSON-RPC error response (`-32001`) when daemon transport is unavailable.
- Intent:
  - Prevent request hangs when daemon transport drops.

### 2) Sampling compatibility + fallback hardening
- File: `src/server.ts`
- Key changes:
  - `extractTextFromContent` now handles additional text shapes robustly.
  - Added `buildLegacyToolCallsPrompt(...)` for explicit JSON `tool_calls` fallback instruction.
  - Added `buildLegacyToolCallsUserNudge(...)` to reinforce strict JSON response via user message in fallback calls.
  - Tool forwarding default changed to ON unless `MCP_SAMPLING_ENABLE_TOOLS=false`.
  - Added explicit tool name extraction from multiple `tool_choice` shapes.
  - Added two fallback paths:
    - On createMessage failure with tools (e.g. sampling.tools capability error), retry without tools + JSON tool_calls prompt.
    - On empty tool-calls under `required` mode, retry once in the same legacy JSON fallback mode.

### 3) E2E test expansion
- File: `test/e2e-sdk.test.mjs`
- Added/updated tests:
  - Retry path enforces required tool choice.
  - Fallback behavior when `sampling.tools` capability is absent.
  - Required tool choice + empty response path falls back and succeeds.
- Validation:
  - `npm run test:e2e` passes (`8/8`).

## Current Live Status
- Live MCP calls still intermittently fail with safe deny:
  - "Security evaluation failed because the model did not return a valid tool call."
- Logs confirm fallback code paths execute, but model can still return empty content repeatedly.
- Observed in logs:
  - `performLLMCentricEvaluation START`
  - `About to call LLM with Function Calling`
  - `Sampling createMessage with tools failed; retrying with legacy JSON tool_calls fallback`
  - `Sampling returned no tool call under required tool choice; retrying with legacy JSON tool_calls fallback`
  - then final no-tool-call safe deny.

## Important Configuration Notes
- `mcp-shell` workspace has no explicit `SHELL_SERVER_LLM_MODEL`/`SHELL_SERVER_LLM_PROVIDER` configured.
- Runtime currently relies on client-side sampling model selection.
- `.vscode/settings.json` has sampling allowed during chat (`allowedDuringChat: true`), so permission dialog may not appear.

## Open Problem (Root Cause Remaining)
- Not a transport execution gap: sampling path is entered.
- Remaining blocker is provider/model behavior returning empty output instead of tool call under evaluator prompts, even after retries/fallback nudges.

## Recommended Next Steps
1. Add deterministic guard in `shell-server` enhanced evaluator for no-tool-call terminal case:
   - Convert terminal no-tool-call path into deterministic `user_confirm` action instead of hard safe-deny.
2. Optionally add a model/provider compatibility matrix test harness in `shell-server` to detect models that silently return empty content for tool-required prompts.
3. Keep `mcp-shell` fallback logic as-is (already verified by E2E).

## Excluded Local Artifacts (Not Committed Intentionally)
- `.vscode/` (local workspace settings and MCP config; contains local credentials/settings)
- `logs/` (runtime logs)
- `server_start`, `server_stop` (local artifacts)

## Quick Repro Commands
- E2E: `npm run test:e2e`
- Live marker extraction:
  - `rg -n "performLLMCentricEvaluation START|About to call LLM with Function Calling|Sampling createMessage with tools failed|Sampling returned no tool call" logs/mcp_server.log | tail -n 60`
