import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { HeuristicExtractor } from '../../src/pipeline/extractors/heuristic.js';
import { ShareProcessor } from '../../src/pipeline/process-share.js';
import { APP_URL } from '../helpers.js';
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

const processor = new ShareProcessor({
  db,
  logger: pino({ level: 'silent' }),
  heuristic: new HeuristicExtractor(),
  fetchMetadata: async () => {
    throw new Error('prints não devem buscar oEmbed');
  },
  resolvers: [],
});

// Dois prints de um post com lista longa; a rolagem repete os itens 5–7.
const PRINT_1 = [
  '9:41',
  'filmesdasemana',
  'Top 12 filmes para ver no fim de semana 🍿',
  '1. Oppenheimer (2023)',
  '2. Cidade de Deus (2002)',
  '3. Ainda Estou Aqui (2024)',
  '4. Parasita (2019)',
  '5. O Auto da Compadecida (2000)',
  '6. Interestelar (2014)',
  '7. Central do Brasil (1998)',
  'Curtido por joao.silva e outras 1.234 pessoas',
].join('\n');
const PRINT_2 = [
  '9:42',
  '5. O Auto da Compadecida (2000)',
  '6. Interestelar (2014)',
  '7. Central do Brasil (1998)',
  '8. Bacurau (2019)',
  '9. Tropa de Elite (2007)',
  '10. Duna (2021)',
  '11. Whiplash (2014)',
  '12. Coringa (2019)',
  'Ver todos os 87 comentários',
  'há 2 dias',
].join('\n');

type User = Awaited<ReturnType<typeof register>> & { userId: string };

async function newUser(): Promise<User> {
  const user = await register(ctx.http);
  return { ...user, userId: user.refreshToken.split('.')[0]! };
}

async function postPages(user: User, pages: string[]) {
  const res = await ctx.http()
    .post('/shares')
    .set('authorization', `Bearer ${user.accessToken}`)
    .send({ clientShareId: randomUUID(), pages })
    .expect(201);
  return res.body.id as string;
}

async function getShare(user: User, id: string) {
  return (await ctx.http().get(`/shares/${id}`).set('authorization', `Bearer ${user.accessToken}`).expect(200)).body;
}

async function shareFromPrints(user: User, pages: string[]) {
  const shareId = await postPages(user, pages);
  await processor.process({ shareId, userId: user.userId });
  return getShare(user, shareId);
}

describe('prints de tela (OCR no device) e deduplicação', () => {
  it('POST com pages cria share de origem screenshot, sem plataforma inferida', async () => {
    const user = await newUser();
    const id = await postPages(user, [PRINT_1]);
    const share = await getShare(user, id);
    expect(share).toMatchObject({
      status: 'queued',
      source: { platform: 'other', origin: 'screenshot', pageCount: 1 },
      dedup: { pagesIgnored: 0, itemsAlreadyInList: 0 },
    });
  });

  it('dois prints com sobreposição viram 12 itens, sem repetição e sem ruído de UI', async () => {
    const user = await newUser();
    const share = await shareFromPrints(user, [PRINT_1, PRINT_2]);
    expect(share.status).toBe('done');
    expect(share.dedup).toEqual({ pagesIgnored: 0, itemsAlreadyInList: 0 });
    const titles = share.recommendations.map((r: { title: string }) => r.title).sort();
    expect(titles).toEqual(
      [
        'Oppenheimer',
        'Cidade de Deus',
        'Ainda Estou Aqui',
        'Parasita',
        'O Auto da Compadecida',
        'Interestelar',
        'Central do Brasil',
        'Bacurau',
        'Tropa de Elite',
        'Duna',
        'Whiplash',
        'Coringa',
      ].sort(),
    );
    expect(share.recommendations.every((r: { kind: string }) => r.kind === 'movie')).toBe(true);
    expect(share.recommendations.find((r: { title: string }) => r.title === 'Duna').year).toBe(2021);
  });

  it('o mesmo print reenviado em outro share é ignorado (e acento/espaço diferentes do OCR não enganam)', async () => {
    const user = await newUser();
    await shareFromPrints(user, [PRINT_1]);
    const again = await shareFromPrints(user, [PRINT_1.replace('Cidade de Deus', 'Cidade  de  Déus')]);
    expect(again.status).toBe('done');
    expect(again.recommendations).toEqual([]);
    expect(again.dedup).toEqual({ pagesIgnored: 1, itemsAlreadyInList: 0 });
  });

  it('print novo com itens que o usuário já tem: só os inéditos entram', async () => {
    const user = await newUser();
    await shareFromPrints(user, [PRINT_1]);
    const other = await shareFromPrints(user, [
      'Filmes nacionais imperdíveis\n• Cidade de Deus\n• Carandiru (2003)\n• O Som ao Redor (2012)',
    ]);
    expect(other.recommendations.map((r: { title: string }) => r.title).sort()).toEqual(['Carandiru', 'O Som ao Redor']);
    expect(other.dedup).toEqual({ pagesIgnored: 0, itemsAlreadyInList: 1 });
  });

  it('usuários diferentes não interferem entre si', async () => {
    const a = await newUser();
    const b = await newUser();
    await shareFromPrints(a, [PRINT_1]);
    const shareB = await shareFromPrints(b, [PRINT_1]);
    expect(shareB.dedup).toEqual({ pagesIgnored: 0, itemsAlreadyInList: 0 });
    expect(shareB.recommendations).toHaveLength(7);
  });

  it('dois jobs concorrentes com o mesmo print: só um fica com os itens', async () => {
    const user = await newUser();
    const [s1, s2] = await Promise.all([postPages(user, [PRINT_2]), postPages(user, [PRINT_2])]);
    await Promise.all([
      processor.process({ shareId: s1, userId: user.userId }),
      processor.process({ shareId: s2, userId: user.userId }),
    ]);
    const [r1, r2] = await Promise.all([getShare(user, s1), getShare(user, s2)]);
    expect([r1.dedup.pagesIgnored, r2.dedup.pagesIgnored].sort()).toEqual([0, 1]);
    expect(r1.recommendations.length + r2.recommendations.length).toBe(8);
  });

  it('apagar o share ou o share falhar libera o print para reenvio', async () => {
    const user = await newUser();
    const deletedId = await postPages(user, [PRINT_1]);
    await processor.process({ shareId: deletedId, userId: user.userId });
    await ctx.http().delete(`/shares/${deletedId}`).set('authorization', `Bearer ${user.accessToken}`).expect(204);
    const again = await shareFromPrints(user, [PRINT_1]);
    expect(again.dedup.pagesIgnored).toBe(0);
    expect(again.recommendations).toHaveLength(7);

    const other = await newUser();
    const id = await postPages(other, [PRINT_2]);
    await processor.markFailed({ shareId: id, userId: other.userId });
    const retry = await shareFromPrints(other, [PRINT_2]);
    expect(retry.dedup.pagesIgnored).toBe(0);
  });

  it('share de link também não repete item que já está na lista', async () => {
    const user = await newUser();
    // sob "Playlist" o par é Música - Artista; o título do vídeo segue artista primeiro
    await shareFromPrints(user, ['Playlist\n1. Numb - Linkin Park']);
    const linkProcessor = new ShareProcessor({
      db,
      logger: pino({ level: 'silent' }),
      heuristic: new HeuristicExtractor(),
      fetchMetadata: async () => ({ title: 'Linkin Park - Numb (Official Music Video)', author: 'Linkin Park' }),
      resolvers: [],
    });
    const res = await ctx.http()
      .post('/shares')
      .set('authorization', `Bearer ${user.accessToken}`)
      .send({ clientShareId: randomUUID(), text: 'https://youtu.be/kXYiU_JCYtU' })
      .expect(201);
    await linkProcessor.process({ shareId: res.body.id, userId: user.userId });
    const share = await getShare(user, res.body.id);
    expect(share.source.origin).toBe('link');
    expect(share.recommendations).toEqual([]);
    expect(share.dedup).toEqual({ pagesIgnored: 0, itemsAlreadyInList: 1 });
  });

  it('valida pages pelo contrato: até 10 prints de até 8000 caracteres', async () => {
    const user = await newUser();
    const big = 'x'.repeat(8000);
    await ctx.http()
      .post('/shares')
      .set('authorization', `Bearer ${user.accessToken}`)
      .send({ clientShareId: randomUUID(), pages: Array.from({ length: 10 }, (_, i) => `${i}${big}`.slice(0, 8000)) })
      .expect(201);
    for (const pages of [Array.from({ length: 11 }, () => 'a'), ['x'.repeat(8001)], []]) {
      await ctx.http()
        .post('/shares')
        .set('authorization', `Bearer ${user.accessToken}`)
        .send({ clientShareId: randomUUID(), pages })
        .expect(400);
    }
  });

  it('RLS: usuário B não enxerga os hashes de prints de A, nem com SQL direto', async () => {
    const a = await newUser();
    const b = await newUser();
    await shareFromPrints(a, [PRINT_1]);
    const client = new pg.Client({ connectionString: APP_URL });
    await client.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.user_id', $1, true)`, [b.userId]);
      const { rows } = await client.query('select count(*)::int as n from seen_pages where user_id = $1', [a.userId]);
      expect(rows[0].n).toBe(0);
      await expect(
        client.query('insert into seen_pages (user_id, page_hash, first_share_id) values ($1, $2, gen_random_uuid())', [
          a.userId,
          'f'.repeat(64),
        ]),
      ).rejects.toThrow(/row-level security/);
      await client.query('rollback');

      await client.query('begin');
      await client.query(`select set_config('app.user_id', $1, true)`, [a.userId]);
      const own = await client.query('select page_hash from seen_pages where user_id = $1', [a.userId]);
      expect(own.rows).toHaveLength(1);
      expect(own.rows[0].page_hash).toMatch(/^[a-f0-9]{64}$/);
      await client.query('rollback');
    } finally {
      await client.end();
    }
  });
});
