/** Minúsculas, sem acento e com espaços colapsados: a forma em que os léxicos são escritos. */
export function normalizeMoodText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Casa um termo como palavra(s) inteira(s); `*` no fim vira prefixo ("suicid*"). */
export function termRegex(term: string): RegExp {
  const prefix = term.endsWith('*');
  const body = (prefix ? term.slice(0, -1) : term)
    .split(' ')
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  return new RegExp(`(?:^|\\s)${body}${prefix ? '\\w*' : ''}(?=\\s|$)`);
}
