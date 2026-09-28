import { describe, expect, it } from '@jest/globals';

import { applyTheme, colors, currentTheme, gradients, onThemeChange, resolveTheme, ui } from '../theme';

describe('tema (escuro/claro)', () => {
  it('"sistema" segue o aparelho; sem informação, o padrão do produto é escuro', () => {
    expect(resolveTheme('system', 'light')).toBe('light');
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('system', null)).toBe('dark');
    expect(resolveTheme('light', 'dark')).toBe('light');
    expect(resolveTheme('dark', 'light')).toBe('dark');
  });

  it('applyTheme troca os tokens no lugar e avisa quem depende deles', () => {
    const seen: string[] = [];
    const off = onThemeChange((n) => seen.push(n));
    const darkBg = colors.bg;

    applyTheme('light');
    expect(currentTheme()).toBe('light');
    expect(colors.bg).not.toBe(darkBg);
    expect(ui.screen.backgroundColor).toBe(colors.bg);
    expect(gradients.hero).toContain('linear-gradient');
    // a capa das listas continua escura nos dois temas (iniciais em branco)
    expect(gradients.cover).toContain('#1e3a8a');

    applyTheme('light'); // repetir não dispara de novo
    applyTheme('dark');
    expect(colors.bg).toBe(darkBg);
    expect(seen).toEqual(['light', 'dark']);
    off();
  });
});
