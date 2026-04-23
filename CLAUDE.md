# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

This is a **read-only TypeScript/TSX source snapshot of the Claude Code CLI**, recovered from a leaked source map in a published npm package (see `README.md` for the full backstory). It is **not a buildable project**:

- No `package.json`, lockfile, `tsconfig.json`, or CI config is checked in
- No test suite, no build scripts, no lint config
- The original CLI was bundled with Bun; none of that toolchain is present here

Treat edits as **source-level analysis and targeted patches**, not changes that can be compiled or run locally. There is nothing to build, no tests to run, and no formatter to invoke — do not hallucinate commands that do not exist.

## Orientation: read these first

Rich architecture documentation already exists at the repo root — prefer reading it over re-deriving structure from code:

- `ARCHITECTURE.md` — top-to-bottom map of the runtime (启动装配 → REPL → QueryEngine → tools/agents/tasks), with C4 diagrams and a "按问题定位代码" (locate-code-by-problem) index. **Start here.**
- `AGENT_SUBSYSTEM.md` — how `AgentDefinition` / `AgentTool` / `runAgent` / `Task` fit together.
- `SYSTEM_PROMPT_STRUCTURE.md` — how the main system prompt is composed from modular sections in `constants/prompts.ts` and assembled by `utils/systemPrompt.ts` (`buildEffectiveSystemPrompt`).
- `INTENT_RECOGNITION.md` and `AGENT_FLOW_EXAMPLES.md` — how user input is routed and how agents are delegated to.
- `AGENTS.md` — contributor-style conventions specific to this snapshot.
- `ROADMAP.md` — in-flight and planned二次开发 work on this snapshot (telemetry disable, lang-system OTel integration, doc follow-ups). Check here before starting new changes to avoid stepping on ongoing work.

These docs are written in Chinese; the code identifiers are English.

## Architectural backbone

The primary call chain is:

```
main.tsx
  → getCommands(cwd)                    (commands.ts)
  → getTools(permissionContext)         (tools.ts)
  → assembleToolPool(ctx, mcpTools)     (tools.ts)
  → createStore(getDefaultAppState())   (state/AppStateStore.ts)
  → launchRepl(...)                     (replLauncher.tsx)
    → QueryEngine.submitMessage()       (QueryEngine.ts)
      → tool loop → tools/* / AgentTool / MCP
      → Task system (tasks/) for long-lived work
    → AppState updates → Ink UI (components/, screens/, ink/)
```

Two deliberate planes exist and should not be confused:

- **Command plane** (`commands.ts`, `commands/`) — user-invoked slash commands. This is the *control* surface.
- **Tool plane** (`tools.ts`, `tools/`, `Tool.ts`) — model-invoked capabilities during a query. This is the *execution* surface.

Commands and tools are **not static registries**. Both are assembled at runtime based on cwd, permission mode, feature flags, plugins, skills, and MCP state. "Why can/can't the model call X?" is almost always a question about assembly filters in `tools.ts` (permission context, deny rules, REPL/simple-mode narrowing) — not about the tool's own code.

## Key entry files

- `main.tsx` (~785KB) — the composition root; determines run mode (REPL / headless SDK / assistant / remote / direct-connect) and wires everything.
- `commands.ts` — merges built-in commands + bundled skills + `skills/` + workflow commands + plugin commands + plugin skills + dynamic skills.
- `tools.ts` — `getAllBaseTools()` is the source of truth for built-in tools; `getTools()` and `assembleToolPool()` do the filtering/merging.
- `Tool.ts` — runtime contract for tools (`ToolUseContext`, etc.).
- `QueryEngine.ts` / `query.ts` — session engine. `QueryEngine` holds session-level state (`mutableMessages`, `readFileState`, `permissionDenials`, `totalUsage`, `discoveredSkillNames`, `loadedNestedMemoryPaths`), not just a single request.
- `state/AppStateStore.ts` + `getDefaultAppState()` — global runtime state (far broader than a UI store: tasks, permissions, MCP, plugins, agent definitions, bridge/remote state, etc.).
- `remote/RemoteSessionManager.ts` — the remote-mode protocol client (WebSocket subscriptions + HTTP POST + `control_request`/`control_response` flow).

## Feature flag conventions

Large swaths of the codebase are gated out of external builds at compile time. Respect the gating model when editing:

- `feature("FLAG_NAME")` calls come from Bun's `bun:bundle` and are **constant-folded + dead-code-eliminated** in production bundles. Known flags include `PROACTIVE`/`KAIROS`, `BRIDGE_MODE`, `DAEMON`, `VOICE_MODE`, `WORKFLOW_SCRIPTS`, `COORDINATOR_MODE`, `TRANSCRIPT_CLASSIFIER`, `BUDDY`, `HISTORY_SNIP`, `EXPERIMENTAL_SKILL_SEARCH`, `NATIVE_CLIENT_ATTESTATION`.
- `USER_TYPE === 'ant'` gates Anthropic-internal features (staging API, Undercover mode, `/security-review`, `ConfigTool`, `TungstenTool`, prompt dumping).
- Runtime gating uses **GrowthBook**, with many call sites using `getFeatureValue_CACHED_MAY_BE_STALE()` to avoid blocking the main loop — stale values are *acceptable by design*. Don't "fix" this into a blocking lookup.
- `tengu_*` is the internal project codename and prefixes most feature flags / analytics events.

Before assuming a code path is reachable, check its surrounding `feature(...)` / `USER_TYPE` gates.

## Locating code by problem (quick index)

Cross-reference with the longer list in `ARCHITECTURE.md` §"按问题定位代码":

| Problem | Start at |
|---|---|
| Command appears/disappears | `commands.ts` → `commands/<name>/` → `skills/` / `plugins/` |
| Model can/can't call a tool | `tools.ts` (filters) → `Tool.ts` → `tools/<ToolName>/` |
| Why a conversation turn runs the way it does | `QueryEngine.ts` → `query.ts` → `utils/processUserInput/` |
| System prompt content | `constants/prompts.ts` (sections) + `utils/systemPrompt.ts` (merge logic) |
| Subagent background/foreground/recovery | `tools/AgentTool/` → `tasks/LocalAgentTask/LocalAgentTask.tsx` → `tasks/RemoteAgentTask/` |
| Remote / bridge / viewer behavior | `remote/RemoteSessionManager.ts` → `remote/SessionsWebSocket.ts` → `main.tsx` remote branch |

## Editing conventions

- **ES-module imports with explicit `.js` suffixes**, TypeScript types throughout, 2-space indentation. Match the style of the file being edited.
- `PascalCase` for React/Ink components; `camelCase` for functions/variables; feature folders stay cohesive (`commands/agents/`, `tools/FileEditTool/`, `services/api/`).
- Prefer small, focused edits. **Do not rename top-level modules** without a strong, stated reason — the assembly-level imports in `main.tsx`, `commands.ts`, `tools.ts` will break silently in ways you can't run a test to catch.
- Use UTF-8 without BOM when writing files.
- There is no test harness, so describe manual verification (or lack thereof) explicitly when claiming correctness — do not claim a change "passes tests" or "builds cleanly."

## Shell / command conventions on this machine

- Platform is Windows, but the Bash tool runs a Unix-style shell — use forward slashes and Unix syntax (`/dev/null`, not `NUL`). PowerShell 7 (`pwsh.exe`) is also available via the PowerShell tool when a cmdlet is genuinely easier.
- Prefer Grep/Glob/Read over shell-out equivalents.
- Avoid `rg --files` / `Get-ChildItem -Recurse` over the whole tree — `main.tsx` alone is ~785KB and there are hundreds of source files; scope searches with `glob` / `type` / `path` filters.
