import { expect, test } from 'bun:test';

import { translateModelText } from './index';

test('model texts are translated to Portuguese, part by part', () => {
  expect(translateModelText('pt', 'Opus 5.5 · Best for everyday, complex tasks')).toBe('Opus 5.5 · Ideal para tarefas complexas do dia a dia');
  expect(translateModelText('pt', 'Default (recommended)')).toBe('Padrão (recomendado)');
  expect(translateModelText('pt', 'Something new')).toBe('Something new');
  expect(translateModelText('en', 'Fastest for quick answers')).toBe('Fastest for quick answers');
});
