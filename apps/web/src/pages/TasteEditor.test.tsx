import type { TasteProfile } from '@fruiqo/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setAccessToken } from '../api/client';
import { mockApi, renderWithProviders } from '../test/helpers';
import { TasteEditor } from './TasteEditor';

afterEach(() => __setAccessToken(null));

const taste: TasteProfile = {
  genres: [
    { key: 'drama', label: 'Drama', score: 0.9, source: 'signals', signals: 29 },
    { key: 'horror', label: 'Terror', score: -1, source: 'excluded', signals: 5, level: 'hate', learnedScore: 0.4 },
  ],
  subgenres: [
    { key: 'feelgood', label: 'Feel-good', score: 0.5 },
    { key: 'slasher', label: 'Slasher', score: -0.2, pref: 'dislike' },
  ],
  overrides: { pinned: [], excluded: ['horror'] },
  totals: { signals: 44, watched: 10, rated: 2 },
};

const taxonomy = {
  version: 1,
  genres: [
    { key: 'drama', label: 'Drama' },
    { key: 'horror', label: 'Terror' },
    { key: 'animation', label: 'Animação' },
  ],
  subgenres: [
    { key: 'feelgood', label: 'Feel-good' },
    { key: 'slasher', label: 'Slasher' },
    { key: 'tearjerker', label: 'Pra chorar' },
  ],
};

describe('editor do perfil de gosto', () => {
  it('nível por gênero, automático limpa, incluir gênero e alternar subgênero', async () => {
    __setAccessToken('tok');
    mockApi({ 'GET /taxonomy/genres': taxonomy });
    const onChange = vi.fn(async () => undefined);
    const user = userEvent.setup();
    renderWithProviders(<TasteEditor taste={taste} onChange={onChange} />);

    // terror: ajustado por você, nunca sugerido, com o aprendido ao lado
    expect(screen.getByText(/nunca sugerido/)).toBeTruthy();
    expect(screen.getByText(/aprendido: gosto/)).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Seu nível para Terror' })).toHaveProperty('value', 'hate');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Seu nível para Drama' }), 'dislike');
    expect(onChange).toHaveBeenLastCalledWith({ levels: [{ key: 'drama', level: 'dislike' }] });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Seu nível para Terror' }), '');
    expect(onChange).toHaveBeenLastCalledWith({ clear: ['horror'] });

    // incluir gênero que não aparece (só os que faltam são oferecidos)
    await user.click(await screen.findByText('Incluir um gênero que não aparece'));
    const pick = await screen.findByRole('combobox', { name: 'Gênero para incluir' });
    expect([...(pick as HTMLSelectElement).options].map((o) => o.value)).toEqual(['', 'animation']);
    await user.selectOptions(pick, 'animation');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Nível do gênero incluído' }), 'love');
    await user.click(screen.getByRole('button', { name: 'Incluir' }));
    expect(onChange).toHaveBeenLastCalledWith({ levels: [{ key: 'animation', level: 'love' }] });

    // subgênero: automático → gosto; não gosto → automático
    await user.click(screen.getByRole('button', { name: 'Feel-good: automático' }));
    expect(onChange).toHaveBeenLastCalledWith({ subgenres: [{ key: 'feelgood', pref: 'like' }] });
    await user.click(screen.getByRole('button', { name: 'Slasher: não gosto' }));
    expect(onChange).toHaveBeenLastCalledWith({ subgenres: [{ key: 'slasher', pref: null }] });

    await user.click(screen.getByText('Incluir um subgênero que não aparece'));
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Subgênero para incluir' }), 'tearjerker');
    await user.click(screen.getByRole('button', { name: 'Não gosto' }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ subgenres: [{ key: 'tearjerker', pref: 'dislike' }] }));
  });
});
