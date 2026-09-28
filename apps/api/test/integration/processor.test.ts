import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb, withUser } from '../../src/db/client.js';
import { setUserSettings } from './settings-helpers.js';
import { shares } from '../../src/db/schema.js';
import { LlmUnavailableError } from '../../src/pipeline/extractors/anthropic.js';
import { HeuristicExtractor } from '../../src/pipeline/extractors/heuristic.js';
import type { Extractor } from '../../src/pipeline/extractors/types.js';
import { type Resolver, ShareProcessor } from '../../src/pipeline/process-share.js';
import { APP_URL, OWNER_URL } from '../helpers.js';
import { register, startTestApp } from './app.js';

let ctx: Awaited<ReturnType<typeof startTestApp>>;
const { db, pool } = createDb(APP_URL);

beforeAll(async () => {
  ctx = await startTestApp();
});
afterAll(async () => {
  await ctx.app.close();
  await pool.end();
});

async function newShare(text: string) {
  const user = await register(ctx.http);
  const res = await ctx.http()
    .post('/shares')
    .set('authorization', `Bearer ${user.accessToken}`)
    .send({ clientShareId: randomUUID(), text })
    .expect(201);
  const userId = user.refreshToken.split('.')[0]!;
  // SEC-CTRL-51: estes testes exercitam o extrator por LLM, que exige consentimento do usuário
  await setUserSettings(db, userId, { aiConsent: true });
  return { user, shareId: res.body.id as string, userId };
}

const fakeResolver: Resolver = {
  supports: (item) => item.kind === 'music_track',
  resolve: vi.fn(async (item) => ({
    provider: 'spotify' as const,
    externalId: 'track:1',
    title: item.title,
    url: 'https://open.spotify.com/track/1',
  })),
};

function processor(overrides: Partial<ConstructorParameters<typeof ShareProcessor>[0]> = {}) {
  return new ShareProcessor({
    db,
    logger: pino({ level: 'silent' }),
    heuristic: new HeuristicExtractor(),
    fetchMetadata: async () => ({ title: 'Linkin Park - Numb (Official Music Video)', author: 'Linkin Park' }),
    resolvers: [fakeResolver],
    ...overrides,
  });
}

async function fetchShare(accessToken: string, id: string) {
  return (await ctx.http().get(`/shares/${id}`).set('authorization', `Bearer ${accessToken}`).expect(200)).body;
}

describe('ShareProcessor', () => {
  it('processa um share do YouTube: oEmbed → heurística → resolução, e apaga o texto bruto', async () => {
    const { user, shareId, userId } = await newShare('https://youtube.com/watch?v=kXYiU_JCYtU&si=track');
    const fetchMetadata = vi.fn(async () => ({ title: 'Linkin Park - Numb (Official Music Video)', author: 'Linkin Park' }));
    await processor({ fetchMetadata }).process({ shareId, userId });

    expect(fetchMetadata).toHaveBeenCalledWith('youtube', 'https://youtube.com/watch?v=kXYiU_JCYtU');
    const share = await fetchShare(user.accessToken, shareId);
    expect(share).toMatchObject({
      status: 'done',
      source: { platform: 'youtube', url: 'https://youtube.com/watch?v=kXYiU_JCYtU', title: expect.stringContaining('Numb') },
      recommendations: [
        {
          kind: 'music_track',
          title: 'Numb',
          creator: 'Linkin Park',
          extractor: 'heuristic',
          resolution: { provider: 'spotify', url: 'https://open.spotify.com/track/1' },
        },
      ],
    });

    const [row] = await withUser(db, userId, (tx) => tx.select().from(shares).where(sql`id = ${shareId}`));
    expect(row?.inputText).toBeNull();
  });

  it('é idempotente: reprocessar um share concluído não faz nada', async () => {
    const { shareId, userId } = await newShare('https://youtu.be/abc');
    const fetchMetadata = vi.fn(async () => null);
    await processor({ fetchMetadata }).process({ shareId, userId });
    await processor({ fetchMetadata }).process({ shareId, userId });
    expect(fetchMetadata).toHaveBeenCalledTimes(1);
  });

  it('link de domínio fora da allowlist não é buscado e é rejeitado', async () => {
    const { user, shareId, userId } = await newShare('https://evil.example.com/page');
    const fetchMetadata = vi.fn();
    await processor({ fetchMetadata }).process({ shareId, userId });
    expect(fetchMetadata).not.toHaveBeenCalled();
    expect((await fetchShare(user.accessToken, shareId)).status).toBe('rejected');
  });

  it('se o LLM não estiver disponível, usa a heurística', async () => {
    const { user, shareId, userId } = await newShare('https://youtu.be/abc');
    const llm: Extractor = {
      name: 'llm',
      extract: vi.fn().mockRejectedValue(new LlmUnavailableError('quota diária de LLM esgotada')),
    };
    await processor({ llm }).process({ shareId, userId });
    const share = await fetchShare(user.accessToken, shareId);
    expect(share.status).toBe('done');
    expect(share.recommendations[0].extractor).toBe('heuristic');
  });

  it('usa o resultado do LLM quando disponível, sem mandar dados de TMDB/Spotify para ele', async () => {
    const { user, shareId, userId } = await newShare('assistam Severance');
    const extract = vi.fn().mockResolvedValue([{ kind: 'series', title: 'Severance', confidence: 0.9 }]);
    await processor({ llm: { name: 'llm', extract } }).process({ shareId, userId });
    const [input] = extract.mock.calls[0]!;
    // só dados; `onUsage` é o callback de contagem de tokens (RF-19), não vai para o prompt
    const dataKeys = Object.keys(input).filter((k) => typeof input[k] !== 'function');
    expect(dataKeys.sort()).toEqual(['origin', 'platform', 'text', 'userId']);
    const share = await fetchShare(user.accessToken, shareId);
    expect(share.recommendations).toEqual([
      expect.objectContaining({ kind: 'series', title: 'Severance', extractor: 'llm' }),
    ]);
  });

  it('markFailed deixa mensagem curta e segura', async () => {
    const { user, shareId, userId } = await newShare('https://youtu.be/abc');
    await processor().markFailed({ shareId, userId });
    const share = await fetchShare(user.accessToken, shareId);
    expect(share).toMatchObject({ status: 'failed', error: 'Não foi possível processar agora' });
  });
});

describe('retenção (TOS-REQ-02 / TOS-REQ-05)', () => {
  it('limpa resolução TMDB > 180 dias e metadados do YouTube > 30 dias', async () => {
    const { user, shareId, userId } = await newShare('https://youtu.be/abc');
    await processor({
      fetchMetadata: async () => ({ title: 'Dune (2021) - Official Trailer' }),
      resolvers: [
        {
          supports: () => true,
          resolve: async () => ({
            provider: 'tmdb' as const,
            externalId: 'movie:1',
            title: 'Duna',
            url: 'https://www.themoviedb.org/movie/1',
          }),
        },
      ],
    }).process({ shareId, userId });

    const owner = new pg.Client({ connectionString: OWNER_URL });
    await owner.connect();
    try {
      await owner.query(`update recommendations set resolved_at = now() - interval '181 days' where share_id = $1`, [shareId]);
      await owner.query(`update shares set source_fetched_at = now() - interval '31 days' where id = $1`, [shareId]);
    } finally {
      await owner.end();
    }

    // a role da aplicação só consegue purgar pela função SECURITY DEFINER
    const res = await db.execute<{ tmdb_cleared: number; youtube_cleared: number }>(
      sql`select * from purge_expired_third_party_data()`,
    );
    expect(res.rows[0]!.tmdb_cleared).toBeGreaterThanOrEqual(1);
    expect(res.rows[0]!.youtube_cleared).toBeGreaterThanOrEqual(1);

    const share = await fetchShare(user.accessToken, shareId);
    expect(share.source.title).toBeUndefined();
    expect(share.recommendations[0].resolution).toBeUndefined();
    expect(share.recommendations[0].title).toBe('Dune');
  });
});
