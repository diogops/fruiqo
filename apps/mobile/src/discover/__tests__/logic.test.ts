import type { Suggestion, Title } from '@fruiqo/contracts';
import { describe, expect, it } from '@jest/globals';

import {
  applyFeedback,
  buildFeedback,
  buildMoodRequest,
  buildSurpriseRequest,
  capitalizeFirst,
  collectGenreOptions,
  moveItem,
  progressOf,
  toggleGenre,
} from '../logic';
import { forgetResult, getResult, putResult, takeRiskText } from '../store';

const RUN = '0b4c7e2a-5d61-4f0a-9c3e-1a2b3c4d5e6f';
const id = (n: number) => `8c1f2e3d-4b5a-4c6d-9e7f-${String(n).padStart(12, '0')}`;

function title(n: number, genres: { key: string; label: string }[] = []): Title {
  return {
    id: id(n),
    kind: 'movie',
    title: `Filme ${n}`,
    status: 'to_watch',
    rank: 1,
    genres,
    subgenres: [],
    enrichment: 'demo',
    decision: 'cataloged',
    confidence: 0.6,
    extractor: 'heuristic',
    shareId: null,
    lists: [],
    createdAt: '2026-09-28T10:00:00.000Z',
    updatedAt: '2026-09-28T10:00:00.000Z',
  };
}
const sug = (n: number): Suggestion => ({ title: title(n), score: 1 - n / 10, reason: 'porque sim', source: 'library' });

describe('buildSurpriseRequest', () => {
  it('usa subgenre para preset de subgênero e genre para gênero', () => {
    expect(buildSurpriseRequest({ key: 'romcom', kind: 'subgenre' })).toEqual({ mode: 'surprise', subgenre: 'romcom' });
    expect(buildSurpriseRequest({ key: 'comedy', kind: 'genre' })).toEqual({ mode: 'surprise', genre: 'comedy' });
  });
});

describe('buildMoodRequest', () => {
  it('apara o texto e recusa vazio', () => {
    expect(buildMoodRequest('   ')).toBeNull();
    expect(buildMoodRequest('  estou triste  ')).toEqual({ mode: 'mood', text: 'estou triste' });
  });
  it('corta em 500 caracteres e marca continueAfterRisk só quando pedido', () => {
    const body = buildMoodRequest('a'.repeat(600), true);
    expect(body).toEqual({ mode: 'mood', text: 'a'.repeat(500), continueAfterRisk: true });
  });
});

describe('buildFeedback', () => {
  it('monta o payload e omite reasonTag ausente', () => {
    expect(buildFeedback(RUN, id(1), 'skip')).toEqual({ runId: RUN, titleId: id(1), action: 'skip' });
    expect(buildFeedback(RUN, id(1), 'another', 'too_heavy')).toEqual({
      runId: RUN,
      titleId: id(1),
      action: 'another',
      reasonTag: 'too_heavy',
    });
  });
});

describe('applyFeedback', () => {
  const list = [sug(1), sug(2), sug(3)];
  it('remove a sugestão e coloca a próxima na mesma posição', () => {
    const out = applyFeedback(list, id(2), sug(4));
    expect(out.map((s) => s.title.id)).toEqual([id(1), id(4), id(3)]);
  });
  it('só remove quando não há próxima ou ela já está na tela', () => {
    expect(applyFeedback(list, id(1), null).map((s) => s.title.id)).toEqual([id(2), id(3)]);
    expect(applyFeedback(list, id(1), sug(3)).map((s) => s.title.id)).toEqual([id(2), id(3)]);
  });
  it('ignora título que não está na lista', () => {
    expect(applyFeedback(list, id(9), sug(4))).toBe(list);
  });
});

describe('moveItem (reordenação da lista)', () => {
  it('sobe e desce trocando com o vizinho', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
  });
  it('não sai dos limites e não muta a entrada', () => {
    const input = ['a', 'b'];
    expect(moveItem(input, 0, -1)).toEqual(['a', 'b']);
    expect(moveItem(input, 1, 1)).toEqual(['a', 'b']);
    expect(input).toEqual(['a', 'b']);
  });
});

describe('progressOf (Continuar)', () => {
  it('rótulo e fração, com limites', () => {
    expect(progressOf(2, 5)).toEqual({ label: '2/5', ratio: 0.4 });
    expect(progressOf(7, 5)).toEqual({ label: '5/5', ratio: 1 });
    expect(progressOf(0, 0)).toEqual({ label: '0/1', ratio: 0 });
  });
});

describe('gêneros', () => {
  it('coleta opções sem repetir, em ordem alfabética', () => {
    const opts = collectGenreOptions(
      [title(1, [{ key: 'romance', label: 'Romance' }, { key: 'comedy', label: 'Comédia' }]), title(2, [{ key: 'comedy', label: 'Comédia' }])],
      [{ key: 'drama', label: 'Drama' }],
    );
    expect(opts.map((o) => o.key)).toEqual(['comedy', 'drama', 'romance']);
  });
  it('alterna seleção respeitando o limite', () => {
    expect(toggleGenre(['a'], 'a')).toEqual([]);
    expect(toggleGenre(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleGenre(['a', 'b'], 'c', 2)).toEqual(['a', 'b']);
  });
});

describe('store em memória do resultado (RNF-06)', () => {
  const base = { runId: RUN, mode: 'mood' as const, aiMode: 'rules' as const, intent: null, surprise: null, suggestions: [] };
  it('só guarda o texto quando há acolhimento de risco, e entrega uma única vez', () => {
    putResult({ ...base, risk: null }, 'texto sem risco');
    expect(takeRiskText(RUN)).toBeUndefined();

    const risk = {
      title: 'Você não está sozinho',
      message: 'm',
      cvvPhone: '188',
      cvvUrl: 'https://cvv.org.br',
      emergencyPhone: '192',
      continueLabel: 'Ver sugestões',
    };
    putResult({ ...base, risk }, 'texto com risco');
    expect(getResult(RUN)?.risk?.cvvPhone).toBe('188');
    expect(takeRiskText(RUN)).toBe('texto com risco');
    expect(takeRiskText(RUN)).toBeUndefined();
    forgetResult(RUN);
    expect(getResult(RUN)).toBeUndefined();
  });
});

describe('capitalizeFirst', () => {
  it('capitaliza a primeira letra do rótulo da intenção', () => {
    expect(capitalizeFirst('levantar o astral')).toBe('Levantar o astral');
    expect(capitalizeFirst('ótimo para rir')).toBe('Ótimo para rir');
    expect(capitalizeFirst('')).toBe('');
  });
});
