# ReilAI | agent rules

Read `docs/architecture.md` and `docs/security.md` before changing behavior.

- Runtime and package manager: **Bun** (workspaces + Turborepo). No npm/pnpm lockfiles.
- The daemon (`apps/cli/src/daemon`) is the only owner of agent processes and the database.
  Web and tunnel are independent processes that only proxy RPC/events; never make one depend on the other.
- New RPC methods go in `packages/protocol` (`RpcMethods`). Only add them to `REMOTE_METHODS`
  if remote devices may call them.
- Any change to the tunnel crypto must be mirrored in `packages/crypto`, `apps/tunnel/src/device-client.ts`
  and `apps/app/android/.../SecureChannel.kt`, and pass `bun test` + `apps/tunnel/scripts/smoke.ts`.
- UI text always through `packages/i18n` (`en.ts` is the source, `pt.ts` must have every key).
- Colors only through the palette tokens (`packages/brand/src/palette.ts`): `var(--token)` in CSS, `C.token` inline.
  Icons only from the Solar set (`packages/brand/scripts/generate-icons.ts`).
- Lynx screens never open sockets or call `fetch`: they use `ReilHost` (`apps/app/src/shared/host.ts`),
  implemented by the web shell (`apps/web/src/shell/lynx.ts`) and the Android host (`ReilHost.kt`).
- Writing style (docs, commits, UI copy): no em dashes; use `:`, `|`, commas or parentheses.
- Gate before committing: `bun run check-types` and `bun run test`.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
