import { describe, expect, it } from 'vitest';
import { HeuristicExtractor } from '../../src/pipeline/extractors/heuristic.js';

const h = new HeuristicExtractor();
const base = { userId: 'u', platform: 'youtube' as const };

describe('HeuristicExtractor', () => {
  it('"Artista - Música" vira music_track sem ruído de título', async () => {
    const [item] = await h.extract({
      ...base,
      title: "Linkin Park - What I've Done (Live, 2025) / w Chester Bennington ^_^ #linkinpark",
    });
    expect(item).toMatchObject({ kind: 'music_track', creator: 'Linkin Park', title: "What I've Done" });
  });

  it('remove "(Official Music Video)"', async () => {
    const [item] = await h.extract({ ...base, title: 'Daft Punk - Get Lucky (Official Music Video)' });
    expect(item).toMatchObject({ kind: 'music_track', creator: 'Daft Punk', title: 'Get Lucky' });
  });

  it('trailer vira movie com ano; "temporada" vira series', async () => {
    const [movie] = await h.extract({ ...base, title: 'Dune: Part Two (2024) - Official Trailer' });
    expect(movie).toMatchObject({ kind: 'movie', title: 'Dune: Part Two', year: 2024 });

    const [series] = await h.extract({ ...base, title: 'The Bear Temporada 3 | Trailer Oficial' });
    expect(series?.kind).toBe('series');
  });

  it('título sem padrão vira "other" com confiança baixa', async () => {
    const [item] = await h.extract({ ...base, title: 'Minha rotina de manhã' });
    expect(item).toMatchObject({ kind: 'other', confidence: 0.2 });
  });

  it('sem título usa a primeira linha do texto, sem a URL', async () => {
    const items = await h.extract({ ...base, platform: 'other', text: 'https://x.y/z\nassista Succession' });
    expect(items).toEqual([{ kind: 'other', title: 'assista Succession', confidence: 0.1 }]);
  });

  it('só URL e nada mais não gera item', async () => {
    expect(await h.extract({ ...base, platform: 'other', text: 'https://x.y/z' })).toEqual([]);
  });
});
