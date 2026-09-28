import type { Resolution } from '@fruiqo/contracts';
import { z } from 'zod';
import type { ExtractedItem } from '../extractors/types.js';
import { safeFetchJson, type SafeFetchOptions } from '../safe-fetch.js';

const TokenSchema = z.object({ access_token: z.string(), expires_in: z.number() });

const Image = z.object({ url: z.url() });
const Item = z.object({
  id: z.string(),
  name: z.string(),
  external_urls: z.object({ spotify: z.url() }),
  images: z.array(Image).optional(),
  release_date: z.string().optional(),
  album: z.object({ images: z.array(Image), release_date: z.string().optional() }).optional(),
});
const SearchSchema = z.object({
  tracks: z.object({ items: z.array(Item) }).optional(),
  albums: z.object({ items: z.array(Item) }).optional(),
  artists: z.object({ items: z.array(Item) }).optional(),
});

const TYPE: Record<string, 'track' | 'album' | 'artist'> = {
  music_track: 'track',
  music_album: 'album',
  artist: 'artist',
};

/** Busca no catálogo via client credentials (só busca + link de volta: TOS-REQ-10/11). */
export class SpotifyResolver {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl?: SafeFetchOptions['fetchImpl'],
  ) {}

  supports(item: ExtractedItem): boolean {
    return item.kind in TYPE;
  }

  async resolve(item: ExtractedItem): Promise<Resolution | null> {
    const type = TYPE[item.kind];
    if (!type) return null;
    const q =
      type === 'track' && item.creator ? `track:${item.title} artist:${item.creator}` : item.title;
    const params = new URLSearchParams({ q, type, limit: '1', market: 'BR' });
    const data = SearchSchema.parse(
      await safeFetchJson(`https://api.spotify.com/v1/search?${params}`, {
        headers: { authorization: `Bearer ${await this.accessToken()}` },
        fetchImpl: this.fetchImpl,
      }),
    );
    const hit = (type === 'track' ? data.tracks : type === 'album' ? data.albums : data.artists)?.items[0];
    if (!hit) return null;

    const image = hit.album?.images[0]?.url ?? hit.images?.[0]?.url;
    const date = hit.album?.release_date ?? hit.release_date;
    const year = date ? Number(date.slice(0, 4)) : undefined;
    return {
      provider: 'spotify',
      externalId: `${type}:${hit.id}`,
      title: hit.name,
      url: hit.external_urls.spotify,
      ...(image ? { imageUrl: image } : {}),
      ...(year && Number.isInteger(year) ? { year } : {}),
    };
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const data = TokenSchema.parse(
      await safeFetchJson('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          authorization: `Basic ${basic}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
        fetchImpl: this.fetchImpl,
      }),
    );
    this.token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return data.access_token;
  }
}
