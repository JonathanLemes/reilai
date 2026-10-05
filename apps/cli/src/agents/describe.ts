/** Human titles and approval details for tool calls (shared by both agents). */

const MAX_DETAIL = 4000;

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function short(path: string): string {
  const parts = path.split('/');
  return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : path;
}

function clip(text: string, max = MAX_DETAIL): string {
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

export function toolTitle(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'Bash':
    case 'bash':
      return `$ ${str(i.command).split('\n')[0]}`;
    case 'Read':
      return `Read ${short(str(i.file_path))}`;
    case 'Write':
      return `Write ${short(str(i.file_path))}`;
    case 'Edit':
    case 'MultiEdit':
      return `Edit ${short(str(i.file_path))}`;
    case 'NotebookEdit':
      return `Edit ${short(str(i.notebook_path))}`;
    case 'Grep':
      return `Search “${str(i.pattern)}”`;
    case 'Glob':
      return `Find ${str(i.pattern)}`;
    case 'WebFetch':
      return `Fetch ${str(i.url)}`;
    case 'WebSearch':
      return `Search the web: ${str(i.query)}`;
    case 'Task':
    case 'Agent':
      return str(i.description) || 'Subagent';
    case 'TodoWrite':
      return 'Update the plan';
    case 'ExitPlanMode':
      return 'Ready to start implementing';
    case 'AskUserQuestion':
      return 'Question for you';
    default:
      return name.startsWith('mcp__') ? name.split('__').slice(1).join(' · ') : name;
  }
}

export function toolDetail(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'Bash':
    case 'bash':
      return clip(str(i.command) + (i.description ? `\n\n# ${str(i.description)}` : ''));
    case 'Edit':
      return clip(`${str(i.file_path)}\n\n- ${str(i.old_string).split('\n').join('\n- ')}\n+ ${str(i.new_string).split('\n').join('\n+ ')}`);
    case 'MultiEdit': {
      const edits = Array.isArray(i.edits) ? (i.edits as Record<string, unknown>[]) : [];
      return clip(
        `${str(i.file_path)}\n\n${edits.map((e) => `- ${str(e.old_string)}\n+ ${str(e.new_string)}`).join('\n\n')}`,
      );
    }
    case 'Write':
      return clip(`${str(i.file_path)}\n\n${str(i.content)}`, 1500);
    case 'ExitPlanMode':
      return clip(str(i.plan));
    case 'AskUserQuestion': {
      const qs = Array.isArray(i.questions) ? (i.questions as Record<string, unknown>[]) : [];
      return clip(qs.map((q) => str(q.question)).join('\n'));
    }
    default:
      return clip(JSON.stringify(input ?? {}, null, 2));
  }
}

/** Tool results come as strings or content-block arrays. */
export function resultText(content: unknown): string {
  if (typeof content === 'string') return clip(content, 20000);
  if (Array.isArray(content)) {
    return clip(
      content
        .map((block) => {
          const b = block as { type?: string; text?: string };
          return b.type === 'text' ? (b.text ?? '') : b.type === 'image' ? '[image]' : '';
        })
        .join('\n'),
      20000,
    );
  }
  return content == null ? '' : clip(JSON.stringify(content), 20000);
}
