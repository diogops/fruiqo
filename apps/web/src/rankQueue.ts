// Atualização otimista da fila de prioridade no catálogo: aplica localmente o mesmo deslocamento
// que a API faz em POST /library/:id/move, sobre os títulos já carregados.
import type { MoveTitleRequest } from '@fruiqo/contracts';

export interface Ranked {
  id: string;
  rank: number | null;
}

/** Posição final (1..total) para um pedido de movimento, igual à regra da API. */
export function targetPosition(from: number, total: number, req: MoveTitleRequest): number {
  if ('position' in req) return Math.min(Math.max(req.position, 1), total);
  switch (req.to) {
    case 'top':
      return 1;
    case 'bottom':
      return total;
    case 'up':
      return Math.max(from - 1, 1);
    case 'down':
      return Math.min(from + 1, total);
  }
}

/** Novas posições dos itens carregados depois de mover `id` de `from` para `to`. */
export function shiftRanks(items: Ranked[], id: string, from: number, to: number): Map<string, number> {
  const next = new Map<string, number>();
  for (const it of items) {
    if (it.rank == null) continue;
    let r = it.rank;
    if (it.id === id) r = to;
    else if (to < from && r >= to && r < from) r += 1;
    else if (to > from && r > from && r <= to) r -= 1;
    next.set(it.id, r);
  }
  return next;
}
