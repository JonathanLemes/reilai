import type { Language } from './index';

/**
 * Model names and descriptions come from the agents in English (Claude Agent SDK,
 * codex app-server). Known phrases are translated here; unknown ones stay as-is.
 * Composite descriptions ("Opus 5.5 · Best for…") are translated part by part.
 */
const PT: Record<string, string> = {
  'Default (recommended)': 'Padrão (recomendado)',
  Default: 'Padrão',
  'Best for everyday, complex tasks': 'Ideal para tarefas complexas do dia a dia',
  'For complex work and everyday tasks': 'Para trabalho complexo e tarefas do dia a dia',
  'Most efficient for simpler tasks': 'Mais eficiente para tarefas simples',
  'For your toughest challenges': 'Para os seus desafios mais difíceis',
  'Fastest for quick answers': 'O mais rápido, para respostas curtas',
  'Efficient for routine tasks': 'Eficiente para tarefas de rotina',
  'Most capable for your hardest and longest-running tasks': 'O mais capaz, para as tarefas mais difíceis e longas',
  'Most capable': 'O mais capaz',
  'Fast and capable': 'Rápido e capaz',
  Fastest: 'O mais rápido',
  'Your Claude Code default': 'O padrão do seu Claude Code',
  'Your Codex default': 'O padrão do seu Codex',
  'Frontier intelligence for the most demanding work.': 'Inteligência de ponta para o trabalho mais exigente.',
  'Previous generation workhorse model.': 'Modelo de uso geral da geração anterior.',
  'Fast and affordable model for easier tasks.': 'Modelo rápido e econômico para tarefas mais simples.',
  'Older generation workhorse model.': 'Modelo de uso geral de uma geração mais antiga.',
  'Older balanced model for straightforward work.': 'Modelo equilibrado mais antigo, para trabalho direto.',
  'Older fast and efficient model.': 'Modelo rápido e eficiente mais antigo.',
  'Legacy coding model.': 'Modelo de código legado.',
};

function one(text: string): string {
  const exact = PT[text.trim()];
  return exact ?? text;
}

export function translateModelText(lang: Language, text: string | undefined | null): string {
  if (!text) return '';
  if (lang === 'en') return text;
  return text
    .split(' · ')
    .map((part) => one(part))
    .join(' · ');
}
