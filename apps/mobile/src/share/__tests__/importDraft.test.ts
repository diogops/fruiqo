import { extractCandidates } from '@fruiqo/contracts';
import { describe, expect, it } from '@jest/globals';

import { draftFromOcr, setImportDraft, takeImportDraft } from '../importDraft';

describe('rascunho do "Conferir títulos" (OCR no aparelho)', () => {
  it('junta as linhas dos prints na ordem e ignora print sem texto', () => {
    const d = draftFromOcr([['12:57', '1. Instinto Materno (2024)'], null, [], ['2. Match Point (2006)', 'Seguir']])!;
    expect(d.prints).toBe(2);
    expect(d.lines.map((l) => l.text)).toEqual(['12:57', '1. Instinto Materno (2024)', '2. Match Point (2006)', 'Seguir']);
    expect(d.fullText).toBe('12:57\n1. Instinto Materno (2024)\n\n2. Match Point (2006)\nSeguir');
    // mesmas regras do web: só os itens de lista vêm marcados e visíveis
    const c = extractCandidates(d.lines);
    expect(c.filter((x) => x.visible).map((x) => x.text)).toEqual(['Instinto Materno (2024)', 'Match Point (2006)']);
  });

  it('sem texto nenhum não abre a conferência', () => {
    expect(draftFromOcr([null, [], ['   ']])).toBeNull();
  });

  it('o rascunho é entregue uma vez só (fica só em memória)', () => {
    setImportDraft({ lines: [{ text: 'Up', confidence: 90 }], fullText: 'Up', prints: 1 });
    expect(takeImportDraft()?.fullText).toBe('Up');
    expect(takeImportDraft()).toBeNull();
  });
});
