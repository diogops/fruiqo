import { describe, expect, it } from 'vitest';
import { candidateKey, extractCandidates, isGarbled, isUiNoise, stripListMarker } from './candidates';
import type { OcrLine } from './engine';

const L = (text: string, confidence = 90): OcrLine => ({ text, confidence });
let n = 0;
const ids = () => `id${++n}`;

describe('candidatos a título a partir do OCR', () => {
  it('post em português com lista numerada: só os itens vêm marcados; o resto fica visível', () => {
    const lines = [
      L('12:57'),
      L('dicas_de_filmes Seguir'),
      L('Seguir'),
      L('Mais informações sobre os filmes'),
      L('1. Instinto Materno (2024)'),
      L('»Disponível no Telecine'),
      L('Drama / Suspense • IMDb 6,3 • Minha Nota 8,8'),
      L('2. Match Point (2006)'),
      L('3. O Nevoeiro (2007)'),
      L('Há 21 horas'),
      L('O que você acha disso?'),
    ];
    const c = extractCandidates(lines, ids);
    expect(c.filter((x) => x.selected).map((x) => x.text)).toEqual(['Instinto Materno (2024)', 'Match Point (2006)', 'O Nevoeiro (2007)']);
    // não some nada que possa ser útil: continua na lista, desmarcado
    expect(c.map((x) => x.text)).toContain('Disponível no Telecine');
    // interface filtrada: horário, botão, tempo relativo, caixa de comentário
    expect(c.map((x) => x.text)).not.toContain('12:57');
    expect(c.map((x) => x.text)).not.toContain('Seguir');
    expect(c.map((x) => x.text)).not.toContain('Há 21 horas');
    expect(c.map((x) => x.text)).not.toContain('O que você acha disso?');
    // a categoria nunca é inventada
    expect(c.every((x) => x.kind === null)).toBe(true);
  });

  it('lista em inglês com bullets', () => {
    const c = extractCandidates([L('Movies to watch this weekend'), L('• The Shining'), L('• Past Lives (2023)'), L('- Up'), L('Follow'), L('1,204 likes')], ids);
    expect(c.filter((x) => x.selected).map((x) => x.text)).toEqual(['The Shining', 'Past Lives (2023)', 'Up']);
    expect(c.map((x) => x.text)).not.toContain('Follow');
    expect(c.map((x) => x.text)).not.toContain('1,204 likes');
  });

  it('títulos curtos, numéricos e acentuados sobrevivem; repetidos saem sem mudar o texto exibido', () => {
    const c = extractCandidates([L('It'), L('Up'), L('1984'), L('Cidade de Deus'), L('CIDADE DE DEUS'), L('Ação'), L('Acao'), L('2001: Uma Odisseia no Espaço')], ids);
    expect(c.map((x) => x.text)).toEqual(['It', 'Up', '1984', 'Cidade de Deus', 'Ação', '2001: Uma Odisseia no Espaço']);
    // sem itens de lista, a pré-seleção é pela confiança da leitura
    expect(c.every((x) => x.selected)).toBe(true);
  });

  it('lixo de leitura sai; leitura de baixa confiança só vira aviso', () => {
    const c = extractCandidates([L('| ¥'), L('Ph | FP as |'), L('Coraline', 40), L('   ')], ids);
    expect(c.map((x) => x.text)).toEqual(['Coraline']);
    expect(c[0]).toMatchObject({ uncertain: true, selected: false });
  });

  it('marcadores: número e bullet contam como lista; emoji lido como símbolo só é removido', () => {
    expect(stripListMarker('1. Duna')).toEqual({ text: 'Duna', marked: true });
    expect(stripListMarker('#2) Maid')).toEqual({ text: 'Maid', marked: true });
    expect(stripListMarker('• Soul')).toEqual({ text: 'Soul', marked: true });
    expect(stripListMarker('»Disponível no Prime Video')).toEqual({ text: 'Disponível no Prime Video', marked: false });
    expect(stripListMarker('1984')).toEqual({ text: '1984', marked: false });
    expect(stripListMarker('9 Canções')).toEqual({ text: '9 Canções', marked: false });
  });

  it('"🎬 Título: onde assistir" com o emoji lido como "EB": só o título, sem o serviço e sem a manchete', () => {
    const lines = [
      'Siga @perfil.teste',
      'EB 6 FILMES DE SUSPENSE PARA UMA NOITE DE CHUVA',
      'Separei filmes com ideias simples e finais que ninguém espera.',
      'ONDE ASSISTIR:',
      'EB A Casa do Lago Escuro: Indisponível em streaming no momento',
      'EB Silêncio: O Retorno: Plex',
      'EB Ninguém Sai Daqui: Disney+',
      'EB Linha Cruzada: Telecine / Universal+',
      'EB Duplo: MGM +',
      'Qual desses te ganhou só pela ideia?',
    ].map((t) => L(t));
    const c = extractCandidates(lines, ids);
    expect(c.filter((x) => x.selected).map((x) => x.text)).toEqual(['A Casa do Lago Escuro', 'Silêncio: O Retorno', 'Ninguém Sai Daqui', 'Linha Cruzada', 'Duplo']);
    expect(c.map((x) => x.text)).toContain('EB 6 FILMES DE SUSPENSE PARA UMA NOITE DE CHUVA');
  });

  it('dois-pontos que não é serviço fica intacto', () => {
    const c = extractCandidates([L('2001: Uma Odisseia no Espaço'), L('Duna: Parte Dois (2024)'), L('Missão: Impossível')], ids);
    expect(c.map((x) => x.text)).toEqual(['2001: Uma Odisseia no Espaço', 'Duna: Parte Dois (2024)', 'Missão: Impossível']);
  });

  it('regras pequenas de interface e de lixo', () => {
    expect(isUiNoise('9:41')).toBe(true);
    expect(isUiNoise('12:57 nw Te)')).toBe(true);
    expect(isUiNoise('2:22 Um Dia Especial')).toBe(false);
    expect(isUiNoise('@perfil.teste')).toBe(true);
    expect(isUiNoise('#filmes #cinema')).toBe(true);
    expect(isUiNoise('3 d')).toBe(true);
    expect(isUiNoise('Ver tradução')).toBe(true);
    expect(isUiNoise('Seven')).toBe(false);
    expect(isGarbled('| ¥ |')).toBe(true);
    expect(isGarbled('Amélie')).toBe(false);
    expect(candidateKey('  Amélie!! ')).toBe(candidateKey('amelie'));
  });
});
