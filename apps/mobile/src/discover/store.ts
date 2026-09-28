// Guarda o último resultado de /discover só em memória, para a tela de resultado ler sem refazer a
// chamada. O texto do "Como estou" fica aqui SOMENTE enquanto há um acolhimento de risco pendente
// (para o "quero ver sugestões mesmo assim"); é apagado assim que o usuário decide ou sai da tela.
// Nada disso vai para disco (RNF-06).
import type { DiscoverResponse } from '@fruiqo/contracts';

type Entry = { result: DiscoverResponse; pendingRiskText?: string };

const results = new Map<string, Entry>();
const MAX_ENTRIES = 5;

export function putResult(result: DiscoverResponse, moodText?: string): void {
  const entry: Entry = { result };
  if (result.risk && moodText) entry.pendingRiskText = moodText;
  results.set(result.runId, entry);
  while (results.size > MAX_ENTRIES) {
    const oldest = results.keys().next().value;
    if (oldest === undefined) break;
    results.delete(oldest);
  }
}

export function getResult(runId: string): DiscoverResponse | undefined {
  return results.get(runId)?.result;
}

/** Devolve e apaga o texto guardado para o "continuar mesmo assim". */
export function takeRiskText(runId: string): string | undefined {
  const entry = results.get(runId);
  const text = entry?.pendingRiskText;
  if (entry) delete entry.pendingRiskText;
  return text;
}

export function forgetResult(runId: string): void {
  results.delete(runId);
}
