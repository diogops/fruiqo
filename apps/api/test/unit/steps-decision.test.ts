import { describe, expect, it } from 'vitest';
import { scoreMood, scoreShare } from '../../src/eval/metrics.js';
import { decideCandidate, DEFAULT_DECISION_POLICY } from '../../src/pipeline/process-share.js';
import { preview, StepRecorder } from '../../src/pipeline/steps.js';

const item = (confidence: number) => ({ kind: 'movie' as const, title: 'X', confidence });
const res = { provider: 'tmdb' as const, externalId: 'movie:1', title: 'X', url: 'https://www.themoviedb.org/movie/1' };

describe('decideCandidate (RF-19/RF-28)', () => {
  it('confiança decide primeiro; "sem correspondência" só com resolver disponível', () => {
    const p = DEFAULT_DECISION_POLICY;
    expect(decideCandidate(item(0.1), null, false, p)).toEqual({ decision: 'discarded', reason: 'confidence_below_discard' });
    expect(decideCandidate(item(0.45), res, true, p)).toEqual({ decision: 'review_queue', reason: 'confidence_below_review' });
    expect(decideCandidate(item(0.6), null, true, p)).toEqual({ decision: 'review_queue', reason: 'no_catalog_match' });
    expect(decideCandidate(item(0.6), null, false, p)).toEqual({ decision: 'cataloged', reason: 'confident' });
    expect(decideCandidate(item(0.6), res, true, p)).toEqual({ decision: 'cataloged', reason: 'resolved' });
  });

  it('limiares configuráveis', () => {
    expect(decideCandidate(item(0.45), null, false, { reviewThreshold: 0.4, discardThreshold: 0.1 }).decision).toBe('cataloged');
  });
});

describe('StepRecorder (RF-19)', () => {
  it('fora de fixture, tira trechos de texto de terceiros dos resumos', async () => {
    const rec = new StepRecorder('live', false);
    await rec.run('metadata', { platform: 'youtube' }, async () => 'ok', () => ({ found: true, preview: 'Título do vídeo' }));
    expect(rec.steps[0]).toMatchObject({ seq: 0, step: 'metadata', mode: 'live', outputSummary: { found: true }, error: null });
    expect(rec.steps[0]!.outputSummary).not.toHaveProperty('preview');
  });

  it('em fixture mantém o trecho, truncado em 200 caracteres', async () => {
    const rec = new StepRecorder('mock', true);
    rec.note('ocr_input', { pages: 1 }, { preview: preview('x'.repeat(500)) });
    expect((rec.steps[0]!.outputSummary.preview as string).length).toBe(200);
  });

  it('registra o erro da etapa e repassa a exceção; custo por tokens', async () => {
    const rec = new StepRecorder('mock', false, { inPerMTok: 1, outPerMTok: 5 });
    await expect(
      rec.run('extract', {}, async () => { throw new Error('falhou aqui'); }, () => ({}), () => ({ inputTokens: 1_000_000, outputTokens: 200_000 })),
    ).rejects.toThrow('falhou aqui');
    expect(rec.steps[0]).toMatchObject({ error: 'falhou aqui', tokensIn: 1_000_000, tokensOut: 200_000, costEstimateUsd: 2 });
  });
});

describe('métricas do eval (RF-22)', () => {
  it('casa por título normalizado e mede kind, resolução e checagens', () => {
    const s = scoreShare(
      {
        status: 'done',
        items: [
          { title: '1. Bacurau (2019)', kind: 'movie', decision: 'cataloged', resolutionId: 'movie:9' },
          { title: 'Coisa extra', kind: 'other', decision: 'review_queue' },
        ],
        source: { platform: 'other', url: null },
        dedup: { pagesIgnored: 0, itemsAlreadyInList: 0 },
        costUsd: 0,
      },
      { status: 'done', items: [{ title: 'Bacurau', kind: 'movie', tmdbId: 'movie:9' }, { title: 'Aquarius', kind: 'movie' }], forbidden: ['Seguir'] },
      'f#0:',
    );
    expect(s).toMatchObject({ tp: 1, fp: 1, fn: 1, kindHits: 1, resolutionHits: 1, review: 1, missing: ['Aquarius'] });
    expect(s.assertions).toEqual({ 'f#0:status': true, 'f#0:forbidden:Seguir': true });
  });

  it('humor: recall de risco e convergência de intenção', () => {
    const m = scoreMood([
      { text: 'quero morrer', risk: true },
      { text: 'morri de rir', risk: false },
      { text: 'preciso chorar', risk: false, intent: { need: 'catharsis' } },
    ]);
    expect(m).toMatchObject({ riskPositives: 1, riskDetected: 1, riskFalsePositives: 0, intentConverged: 1 });
  });
});
