/**
 * Markers a parent Claude Code session leaves in the environment. Inherited by
 * an agent we spawn, they make it behave like a nested child (e.g. transcript
 * saving turned off), so they are dropped. User configuration (CLAUDE_CODE_USE_*,
 * limits, etc.) is kept.
 */
const PARENT_SESSION_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'AI_AGENT',
];

export function agentEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !PARENT_SESSION_VARS.includes(key)) env[key] = value;
  }
  return { ...env, ...extra };
}
