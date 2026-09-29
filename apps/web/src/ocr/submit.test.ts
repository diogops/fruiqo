import type { CandidateDecision } from '@fruiqo/contracts';
import { describe, expect, it } from 'vitest';
import { buildImportRequest, buildImportText, matchOutcomes, sanitizeTitle } from './submit';

const item = (id: string, text: string, kind: 'movie' | 'series' | 'book') => ({ id, text, kind });
const decision = (rawTitle: string, kind: CandidateDecision['kind'], d: CandidateDecision['decision'], reason: string): CandidateDecision => ({
  rawTitle,
  kind,
  confidenceScore: 0.9,
  decision: d,
  reason,
});

describe('cadastro dos títulos confirmados', () => {
  it('um bloco por categoria, com o cabeçalho que o import de .txt entende', () => {
    const text = buildImportText([
      item('1', 'Maid', 'series'),
      item('2', 'Instinto Materno (2024)', 'movie'),
      item('3', '  O   Hobbit ', 'book'),
      item('4', 'Match Point', 'movie'),
    ]);
    expect(text).toBe(['Filmes:', 'Instinto Materno (2024)', 'Match Point', '', 'Séries:', 'Maid', '', 'Livros:', 'O Hobbit'].join('\n'));
    const req = buildImportRequest([item('1', 'Up', 'movie')], '99999999-9999-4999-8999-999999999999');
    expect(req).toEqual({ clientShareId: '99999999-9999-4999-8999-999999999999', textFile: { name: 'Importado de imagem.txt', content: 'Filmes:\nUp' } });
  });

  it('título não vira cabeçalho nem quebra linha', () => {
    expect(sanitizeTitle('Filmes:')).toBe('Filmes');
    expect(sanitizeTitle('Duna:\nParte 2')).toBe('Duna: Parte 2');
    expect(sanitizeTitle('x'.repeat(300))).toHaveLength(200);
  });

  it('resultado por item: revisão, já estava na lista e não cadastrado', () => {
    const items = [item('a', 'Instinto Materno (2024)', 'movie'), item('b', 'Maid', 'series'), item('c', 'Xyz Borrado', 'movie'), item('d', 'Up', 'movie')];
    const decisions = [
      decision('Instinto Materno', 'movie', 'review_queue', 'no_catalog_match'),
      decision('Maid', 'series', 'review_queue', 'already_in_list'),
      decision('Up', 'movie', 'review_queue', 'weak_match'),
    ];
    expect(matchOutcomes(items, decisions).map((r) => [r.item.id, r.outcome])).toEqual([
      ['a', 'review'],
      ['b', 'duplicate'],
      ['c', 'failed'],
      ['d', 'review'],
    ]);
  });

  it('motivo com a sugestão na frente (como o pipeline grava nas importações) também conta como repetido', () => {
    const r = matchOutcomes([item('m', 'Match Point (2006)', 'movie')], [decision('Match Point', 'movie', 'review_queue', 'suggested_cataloged:already_in_list')]);
    expect(r[0]!.outcome).toBe('duplicate');
  });

  it('obras distintas com o mesmo título não se confundem: cada decisão casa com um item só', () => {
    const items = [item('f', 'Duna', 'movie'), item('l', 'Duna', 'book')];
    const decisions = [decision('Duna', 'book', 'review_queue', 'weak_match'), decision('Duna', 'movie', 'review_queue', 'weak_match')];
    expect(matchOutcomes(items, decisions).map((r) => r.outcome)).toEqual(['review', 'review']);
    expect(matchOutcomes(items, [decisions[1]!]).map((r) => r.outcome)).toEqual(['review', 'failed']);
  });

  it('descartado pelo pipeline conta como falha (pode corrigir e reenviar)', () => {
    expect(matchOutcomes([item('x', 'Qwe', 'movie')], [decision('Qwe', 'movie', 'discarded', 'confidence_below_discard')])[0]!.outcome).toBe('failed');
  });
});
