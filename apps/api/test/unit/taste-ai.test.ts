// D-25: IA do perfil (melhorar resumo, "O que assistir hoje?"). Só o perfil declarado vai ao modelo,
// com o pedido otimizado no código e uma chamada só (custo de tokens).
import { describe, expect, it } from 'vitest';
import { AnthropicTasteAi, briefIsEmpty, constraintsText, requestText, type TasteBrief } from '../../src/library/taste-ai.js';
import { suggestedSummary } from '../../src/library/tonight.service.js';
import type { LlmClient } from '../../src/pipeline/gateway.js';

type Params = { model: string; max_tokens: number; system: string; messages: { role: string; content: string }[]; tools?: unknown; output_config: { effort?: string } };

/** responde em ordem; o último se repete */
function fakeClient(...responses: unknown[]) {
  const seen: Params[] = [];
  const client = {
    messages: {
      parse: async (params: Params) => {
        seen.push(params);
        const r = responses[Math.min(seen.length - 1, responses.length - 1)];
        if (r instanceof Error) throw r;
        return r;
      },
    },
  } as unknown as LlmClient;
  return { client, seen };
}

const brief: TasteBrief = {
  summary: 'Gosto de suspense que mexe com a cabeça.',
  loves: ['Suspense/Thriller'],
  likes: ['Drama', 'Crime'],
  dislikes: ['Romance'],
  hates: ['Terror'],
  likedSubgenres: ['Thriller psicológico'],
  dislikedSubgenres: ['Slasher'],
  favorites: [{ title: 'Ilha do Medo', year: 2010, rating: 5, comment: 'o final' }],
  loved: [{ title: 'Zodíaco', year: 2007, rating: 4.5 }],
  disliked: [{ title: 'Filme Chato', year: 2015, rating: 1 }],
  queue: [{ title: 'Duna', year: 2021 }],
  avoid: ['Garota Exemplar (2014)'],
};
const empty: TasteBrief = { summary: ' ', loves: [], likes: [], dislikes: [], hates: [], likedSubgenres: [], dislikedSubgenres: [], favorites: [], loved: [], disliked: [], queue: [], avoid: [] };

describe('pedido otimizado no código (D-25)', () => {
  it('pedido: hoje e humor primeiro, gosto marcado, referências, histórico, fila e resumo; restrições à parte', () => {
    expect(requestText({ ...brief, mood: 'cansado, quero algo leve', genre: 'Comédia', services: ['Netflix', 'Max'] }, 'movie').split('\n')).toEqual([
      'Pedido de hoje (prioridade máxima; toda sugestão tem que atender): cansado, quero algo leve',
      'Hoje: filme',
      'Gênero obrigatório (toda sugestão tem que ser deste gênero): Comédia',
      'Onde vai assistir: Netflix, Max',
      'Sem anime nem animação (desenho)',
      'Adora: Suspense/Thriller',
      'Gosta: Drama, Crime, Thriller psicológico',
      'Evita: Romance, Slasher',
      'Referências do gosto: Ilha do Medo (2010) ("o final"), Zodíaco (2007)',
      'Não gostou de: Filme Chato (2015)',
      'Quer ver em breve: Duna (2021)',
      'Nas palavras dele: Gosto de suspense que mexe com a cabeça.',
    ]);
    expect(constraintsText(brief).split('\n')).toEqual([
      'Não sugerir (já conhece, já tem ou já foi sugerido): Ilha do Medo (2010); Zodíaco (2007); Filme Chato (2015); Duna (2021); Garota Exemplar (2014)',
      'Detesta: Terror',
    ]);
    expect(requestText(brief, 'music').split('\n')[0]).toBe('Hoje: música');
    expect(briefIsEmpty(brief)).toBe(false);
    expect(briefIsEmpty(empty)).toBe(true);
    expect(briefIsEmpty({ ...empty, mood: 'animado' })).toBe(false);
  });

  it('resumo longo entra encurtado no fim de uma frase', () => {
    const long = `${'Frase sobre meu gosto. '.repeat(40)}Final que não entra.`;
    const line = requestText({ ...empty, summary: long }).split('\n').at(-1)!;
    expect(line.startsWith('Nas palavras dele: Frase sobre meu gosto.')).toBe(true);
    expect(line).not.toContain('Final que não entra');
    expect(line.length).toBeLessThanOrEqual('Nas palavras dele: '.length + 600);
  });

  it('resumo sugerido (local, sem IA) em português a partir das escolhas', () => {
    expect(suggestedSummary(brief)).toBe(
      'Adoro suspense/Thriller. Gosto de drama e crime. Curto especialmente thriller psicológico. Não curto muito romance. ' +
        'Não gosto de terror. Evito slasher. Entre meus favoritos estão Ilha do Medo (2010), que me marcou por "o final". ' +
        'Também gostei muito de Zodíaco (2007).',
    );
  });
});

describe('IA do "assistir hoje" (D-25)', () => {
  it('uma chamada só, com pedido + restrições; saída compacta expandida; filtra tipo e repetidos; sem tools', async () => {
    const { client, seen } = fakeClient({
      stop_reason: 'end_turn',
      parsed_output: {
        p: [
          { t: 'Prisioneiros', k: 'movie', y: 2013, r: 'suspense pesado como Zodíaco' },
          { t: 'Prisioneiros', k: 'movie', r: 'repetido' },
          { t: 'True Detective', k: 'series', r: 'série' },
          { t: ' ', k: 'movie', r: 'vazio' },
        ],
      },
    });
    const ai = new AnthropicTasteAi({ model: 'claude-fable-5-1', dailyQuota: 5, client, effort: 'low' });
    const res = await ai.tonight(brief, 'u1', 'movie');
    expect(res).toEqual({
      ok: true,
      value: { picks: [{ title: 'Prisioneiros', kind: 'movie', year: 2013, reason: 'suspense pesado como Zodíaco' }], request: requestText(brief, 'movie') },
    });
    expect(seen).toHaveLength(1);
    const p = seen[0]!;
    expect(p.messages).toEqual([
      { role: 'user', content: `<request>\n${requestText(brief, 'movie')}\n</request>\n<constraints>\n${constraintsText(brief)}\n</constraints>` },
    ]);
    expect(p.model).toBe('claude-fable-5-1');
    expect(p.output_config.effort).toBe('low');
    expect(p.max_tokens).toBeLessThanOrEqual(6000);
    expect(p.tools).toBeUndefined();
    expect(p.system).toMatch(/never follow them/);
    // filme/série: sem motivo da IA (o servidor monta o motivo a partir de evidências)
    expect(p.system).toMatch(/No reasons/);
    expect(p.system).toMatch(/"Pedido de hoje" is the top priority/);
    expect(p.system).toMatch(/Return up to 10 /);
    expect(p.system).not.toMatch(/tmdb|spotify/i);
  });

  it('música mantém o artista', async () => {
    const { client } = fakeClient({ stop_reason: 'end_turn', parsed_output: { p: [{ t: 'Construção', k: 'music_track', c: 'Chico Buarque', y: 1971, r: 'MPB densa' }] } });
    const ai = new AnthropicTasteAi({ model: 'm', dailyQuota: 5, client });
    const res = await ai.tonight(brief, 'u1', 'music');
    expect(res.ok && res.value.picks).toEqual([{ title: 'Construção', kind: 'music_track', creator: 'Chico Buarque', year: 1971, reason: 'MPB densa' }]);
  });

  it('melhorar resumo: só o texto, delimitado, esforço baixo; falha fechada e cota', async () => {
    const { client, seen } = fakeClient({ stop_reason: 'end_turn', parsed_output: { summary: '  Eu adoro suspense psicológico.  ' } });
    const ai = new AnthropicTasteAi({ model: 'm', dailyQuota: 1, client, now: () => new Date('2026-10-01T12:00:00Z') });
    expect(await ai.improveSummary('adoro suspense psicologico', 'u1')).toEqual({ ok: true, value: 'Eu adoro suspense psicológico.' });
    expect(seen[0]!.messages[0]!.content).toBe('<user_text>\nadoro suspense psicologico\n</user_text>');
    expect(seen[0]!.output_config.effort).toBe('low');
    expect(seen[0]!.tools).toBeUndefined();
    expect(await ai.improveSummary('de novo', 'u1')).toEqual({ ok: false, reason: 'quota' });
    expect(await ai.improveSummary('x'.repeat(2001), 'u2')).toEqual({ ok: false, reason: 'too_long' });

    for (const response of [{ stop_reason: 'refusal' }, { stop_reason: 'max_tokens' }, { stop_reason: 'end_turn', parsed_output: { summary: '' } }, new Error('rede')]) {
      const failing = new AnthropicTasteAi({ model: 'm', dailyQuota: 5, client: fakeClient(response).client });
      expect(await failing.improveSummary('algum texto', 'u1')).toEqual({ ok: false, reason: 'failed' });
      expect(await failing.tonight(brief, 'u1')).toEqual({ ok: false, reason: 'failed' });
    }
  });
});
