# Architecture

```
                 ┌──────────── your computer ─────────────────────────────────────┐
  terminal ───── │  reilai CLI ─┐                                                 │
                 │              ├──► daemon (127.0.0.1:7410) ──► Claude Agent SDK │
  browser/PWA ── │ web :7420 ───┤      SQLite, sessions,        └► codex app-server│
                 │              │      live event fan-out                         │
  native app ─┬─ │ tunnel :7430 ┘                                                 │
              │  └─────────────────────────────────────────────────────────────────┘
              └── relay (optional, public host, blind) ◄── tunnel uplink
```

## Processes

| Process | Code | Role |
| --- | --- | --- |
| **daemon** | `apps/cli/src/daemon` | Owns agent processes and the database. JSON RPC + events over a loopback WebSocket. |
| **web** | `apps/web` | Serves the browser shell and Lynx web bundles, proxies RPC/events for browsers. |
| **tunnel** | `apps/tunnel` | Encrypted gateway for paired native apps (direct and/or via relay). |
| **relay** | `apps/relay` | Optional blind forwarder for phones outside your network. |
| **CLI** | `apps/cli/src/cli` | Starts/stops everything, creates and attaches to sessions in the terminal. |

Web and tunnel are independent processes that only talk to the daemon. Stopping one never
affects the other, and because the daemon is the single source of truth, a session started in
the terminal, the browser or the phone shows up everywhere and streams live to every open view.

## Agents

- **Claude Code** (`apps/cli/src/agents/claude.ts`): official `@anthropic-ai/claude-agent-sdk`,
  one long-lived streaming query per session (user turns pushed into an async queue), using the
  locally installed `claude` binary and your existing login and settings. Permissions go through
  `canUseTool`; partial messages give token streaming.
- **Codex** (`apps/cli/src/agents/codex.ts`): `codex app-server` over stdio JSON-RPC (the same
  protocol the IDE extension uses): threads, turns, streamed deltas and approval requests.

Both are normalized into one message model (`packages/protocol`): `text`, `thinking`, `tool`,
`permission` and `event`, with four portable permission modes (`ask`, `edits`, `plan`, `yolo`).
Sessions resume after a daemon restart through the Claude session id or Codex thread id.

Lifecycle: `idle` means the agent process is alive and waiting; `stopped` means there is no
process (stopped by the user, archived, after a daemon restart, or after `REILAI_IDLE_STOP_MINUTES`
of inactivity, 15 by default). Stopping aborts the Claude SDK query (killing the `claude`
process) or terminates `codex app-server`. `sessions.resume` or any new message starts it again
with its previous context.

## Frontend

One Lynx (ReactLynx) project, `apps/app`, one bundle per screen: `sessions`, `chat`, `new`,
`settings`, `pair`. The same source is compiled twice:

- `*.lynx.bundle` for native hosts (`apps/app/android`, Material bottom navigation as the native
  TabBar, one stack per tab, the same model as the Clube do Patriota app).
- `*.web.bundle` rendered by `<lynx-view>` in the web shell (`apps/web`): desktop gets a rail,
  a sessions sidebar and the conversation pane; mobile gets a tab bar and a navigation stack.

Screens never open sockets. They call the `ReilHost` native module, implemented by each host:

| `ReilHost` | Web shell | Android host |
| --- | --- | --- |
| `rpc(method, params, cb)` | WebSocket to the web service | Encrypted tunnel (`Tunnel.kt`) |
| `push/pop/present/dismiss/selectTab` | React layout | Activity stacks / bottom sheet |
| events `reil:event`, `reil:connection`, `reil:theme` | `sendGlobalEvent` | `sendGlobalEvent` |

## i18n

`packages/i18n` holds the English source dictionary and the Portuguese translation
(type-checked to have every key). The language preference is stored by the daemon, so changing
it in any client (or with `reilai lang pt`) switches the CLI, the browser and the phone at once.
`system` follows each client's own locale.

## Local state

`~/.reilai/` (override with `REILAI_HOME`): `reilai.db` (SQLite), `daemon.json`,
`machine.key.json`, `web-token`, `<service>.json` and `logs/`.
