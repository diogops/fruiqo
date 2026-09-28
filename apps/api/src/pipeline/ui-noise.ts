import { normalizeLine } from './dedup.js';

/**
 * Linhas de interface de rede social que o OCR captura junto com o conteúdo do post
 * (Instagram/TikTok/YouTube, pt-BR e en). Os padrões são testados contra a linha normalizada
 * (sem acento, minúscula, espaços colapsados). Para cobrir um app novo, acrescente aqui e em
 * test/unit/ui-noise.test.ts.
 */
export const UI_NOISE_PATTERNS: RegExp[] = [
  // barra de status: horário, bateria
  /^\d{1,2}:\d{2}( ?[ap]\.?m\.?)?$/,
  /^\d{1,3} ?%$/,
  // interação
  /^curtid[oa]s? por\b/,
  /^liked by\b/,
  /^ver (todos )?(os )?(\d+ )?comentarios?\b/,
  /^view (all )?(\d+ )?comments?\b/,
  /^(adicione|adicionar) um comentario/,
  /^add a comment/,
  /^ver traducao$/,
  /^see translation$/,
  /^(ver|see) (mais|more)$/,
  /^\.\.\. ?(mais|more)$/,
  /^(seguir|seguindo|follow|following|responder|reply|mais|more|enviar|send|compartilhar|share|salvar|save|mensagem|message|curtir|like|comentar|comment|remix|editado|edited|traduzido|translated)$/,
  /[•·] ?(seguir|follow|seguindo|following)$/,
  // tempo relativo
  /^ha \d+ (segundos?|minutos?|horas?|dias?|semanas?|meses|mes|anos?)$/,
  /^\d+ (seconds?|minutes?|hours?|days?|weeks?|months?|years?) ago$/,
  /^\d+ ?(s|min|h|d|sem|w|m|a|y)$/,
  // contadores
  /^[\d.,]+ ?(mil|k|m|mi|mi\.)? ?(curtidas?|likes?|comentarios?|comments?|visualizacoes|views|reproducoes|plays|compartilhamentos|shares|seguidores|followers|salvamentos|saves)$/,
  // contador solto ("1.234", "12 mil", "3,4k"); número simples fica (pode ser título, ex.: "1917")
  /^\d{1,3}([.,]\d{3})+$/,
  /^[\d.,]+ ?(mil|k|m|mi)$/,
  // áudio / recomendações / anúncios
  /^(audio original|original audio|som original|original sound)\b/,
  /^sugest(oes|ao) para voce$/,
  /^suggested for you$/,
  /^(patrocinado|sponsored|publicidade|anuncio|ad)$/,
  /^(inscrever-se|inscrito|subscribe|subscribed)$/,
  // perfis: @handle ou nome de usuário com ponto/sublinhado
  /^@[\w.]+$/,
  /^[a-z0-9]+[._][a-z0-9._]+( [•·].*)?$/,
  // linha sem nenhuma letra/dígito (ícones, emojis, separadores)
  /^[^\p{L}\p{N}]*$/u,
];

export function isUiNoise(line: string): boolean {
  const n = normalizeLine(line);
  if (!n) return true;
  return UI_NOISE_PATTERNS.some((re) => re.test(n));
}

export function stripUiNoise(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((l) => !isUiNoise(l))
    .join('\n');
}
