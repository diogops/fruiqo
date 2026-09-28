/** RF-38: serviços que o usuário pode declarar (sem integração; D-05 e matriz da Fase 0). */
export const STREAMING_PROVIDERS = [
  { key: 'netflix', label: 'Netflix', category: 'video' },
  { key: 'prime_video', label: 'Prime Video', category: 'video' },
  { key: 'disney_plus', label: 'Disney+', category: 'video' },
  { key: 'max', label: 'Max', category: 'video' },
  { key: 'globoplay', label: 'Globoplay', category: 'video' },
  { key: 'apple_tv_plus', label: 'Apple TV+', category: 'video' },
  { key: 'paramount_plus', label: 'Paramount+', category: 'video' },
  { key: 'mubi', label: 'MUBI', category: 'video' },
  { key: 'crunchyroll', label: 'Crunchyroll', category: 'video' },
  { key: 'spotify', label: 'Spotify', category: 'music' },
  { key: 'apple_music', label: 'Apple Music', category: 'music' },
  { key: 'deezer', label: 'Deezer', category: 'music' },
  { key: 'youtube_music', label: 'YouTube Music', category: 'music' },
] as const satisfies readonly { key: string; label: string; category: 'video' | 'music' }[];

export const PROVIDER_LABEL = new Map<string, string>(STREAMING_PROVIDERS.map((p) => [p.key, p.label]));

/**
 * Nome do provedor como o TMDB devolve em watch/providers → chave própria. Variantes de canal
 * ("Netflix Standard with Ads", "Amazon Prime Video with Ads", "... Amazon Channel") contam como o
 * serviço base só quando fazem parte da assinatura; canais pagos à parte ficam de fora.
 */
const TMDB_NAME_TO_KEY: [RegExp, string][] = [
  [/^netflix( basic| standard)?( with ads)?$/i, 'netflix'],
  [/^(amazon )?prime video( with ads)?$/i, 'prime_video'],
  [/^disney( plus|\+)$/i, 'disney_plus'],
  [/^(hbo )?max( amazon channel)?$/i, 'max'],
  [/^globoplay$/i, 'globoplay'],
  // o TMDB passou a chamar o Apple TV+ só de "Apple TV"; como só a linha de assinatura (flatrate)
  // vira chave, o mesmo nome na loja (aluguel/compra) não conta como assinatura
  [/^apple tv( plus|\+)?$/i, 'apple_tv_plus'],
  [/^paramount( plus|\+)( premium| basic| essential)?$/i, 'paramount_plus'],
  [/^mubi$/i, 'mubi'],
  [/^crunchyroll$/i, 'crunchyroll'],
];

export function providerKeyFromTmdbName(name: string): string | undefined {
  const n = name.trim();
  return TMDB_NAME_TO_KEY.find(([re]) => re.test(n))?.[1];
}
