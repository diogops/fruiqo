import type { Platform } from '@fruiqo/contracts';

export interface NormalizedSource {
  platform: Platform;
  /** URL canônica sem parâmetros de rastreamento; null se nada utilizável veio no share */
  url: string | null;
}

// Allowlist exata de hostnames (ARB-REQ-01). music.youtube.com fica de fora de propósito:
// P-YTM está BLOQUEADO na matriz de decisão, então é tratado como 'other' (sem fetch).
const HOSTS: Record<string, Platform> = {
  'youtube.com': 'youtube',
  'www.youtube.com': 'youtube',
  'm.youtube.com': 'youtube',
  'youtu.be': 'youtube',
  'instagram.com': 'instagram',
  'www.instagram.com': 'instagram',
  'tiktok.com': 'tiktok',
  'www.tiktok.com': 'tiktok',
  'm.tiktok.com': 'tiktok',
  'vm.tiktok.com': 'tiktok',
  'vt.tiktok.com': 'tiktok',
};

// Parâmetros que só servem para rastrear quem compartilhou (privacidade, device-tests-log F-02).
const TRACKING_PARAMS = new Set([
  'si',
  'is',
  'pp',
  'feature',
  'igsh',
  'igshid',
  'img_index',
  '_r',
  '_t',
  'sender_device',
  'sender_web_id',
  'share_app_id',
  'share_link_id',
  'social_sharing',
  'tt_from',
  'u_code',
  'fbclid',
  'gclid',
]);

const URL_IN_TEXT = /https:\/\/[^\s<>"'`]+/i;

export function extractUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = URL_IN_TEXT.exec(text);
  // tira pontuação final comum em mensagens ("veja isso: https://...).")
  return match ? match[0].replace(/[).,;!?]+$/, '') : null;
}

export function normalizeSource(input: { url?: string | null; text?: string | null }): NormalizedSource {
  const raw = input.url ?? extractUrl(input.text);
  if (!raw) return { platform: 'other', url: null };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { platform: 'other', url: null };
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    return { platform: 'other', url: null };
  }

  const host = parsed.hostname.toLowerCase();
  const platform = HOSTS[host] ?? 'other';

  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) {
      parsed.searchParams.delete(key);
    }
  }
  parsed.hash = '';
  parsed.hostname = host;

  return { platform, url: parsed.toString() };
}
