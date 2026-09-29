# @fruiqo/web — sistema web de organização (Fase 2c)

Interface desktop para organizar o catálogo com mais conforto que no celular. Só consome a API (`apps/api`); nenhuma regra de negócio fica no front (RF-30).

## Rodar

```bash
pnpm infra:up                         # Postgres + Redis
pnpm --filter @fruiqo/api dev         # API em :4000 (WEB_ORIGIN deve incluir http://localhost:5173)
pnpm --filter @fruiqo/web dev         # http://localhost:5173
```

| Variável | Padrão | Uso |
|---|---|---|
| `VITE_API_URL` | `http://localhost:4000` | URL da API |

**Windows:** não rode `pnpm add`/`pnpm install` com o Metro do app mobile ligado (ele trava arquivos do `node_modules`). Pare o Metro antes.

## Sessão (RF-30)

- Access token **só em memória**; o refresh fica no cookie httpOnly `fruiqo_rt` (SameSite=Strict, Path=/auth), que o navegador envia sozinho (`credentials: 'include'`).
- Toda chamada leva `X-Fruiqo-Client: web`, exigido pela API para aceitar o refresh por cookie (proteção contra CSRF junto com a allowlist de origem).
- Em 401 o cliente renova uma única vez (chamadas concorrentes esperam a mesma renovação) e repete a chamada; se falhar, volta ao login.
- Só o e-mail fica no `localStorage` (para o cabeçalho). Tokens nunca.

## Telas

| Rota | Tela | Requisitos |
|---|---|---|
| `/catalogo` | Tabela com filtros (tipo, gênero, status, prioridade, lista, fonte, busca, pendentes), ordenação, edição inline, **ações em massa com Desfazer**, adicionar título, detalhe com correção (409 → mesclar), gêneros e notas | RF-24, RF-25, RF-27 |
| `/listas`, `/listas/:id` | Listas com progresso; detalhe com **drag-and-drop** (alça ou espaço + setas), renomear, fixar no "Continuar", duplicar, excluir | RF-26 |
| `/revisao` | Fila de revisão só pelo teclado: `J`/`K` navegar, `A` aprovar, `R` rejeitar, `E` corrigir e aprovar, `?` atalhos | RF-28 |
| `/atividade`, `/atividade/:shareId` | Compartilhamentos com contagens, deduplicação e custo; inspector com etapas e decisões por candidato, com "Corrigir" | RF-19, RF-27 |
| `/perfil` | Afinidades com a origem de cada uma (fixar/excluir/limpar), assinaturas declaradas, histórico do "Como estou" (só intenções; apagar tudo) | RF-29, RF-38, RNF-06, RNF-10 |
| `/sandbox` | Fixtures sintéticas: rodar em `mock` e ver etapas + diff com o esperado; últimos evals (só com `SANDBOX_ENABLED`) | RF-19, RF-22 |

## Testes

```bash
pnpm --filter @fruiqo/web test        # vitest + Testing Library (jsdom), fetch mockado
pnpm --filter @fruiqo/web typecheck
pnpm --filter @fruiqo/web build
```

Cobertura: fluxo de sessão do cliente (cabeçalho, cookie, renovação única, sessão perdida, validação pelo contrato), fila de revisão inteira só pelo teclado e ação em massa com desfazer no catálogo.

## Produção

- URL: https://fruiqo-web.vercel.app (Vercel, D-19). Build com `VITE_API_URL=/api` (no Git Bash do Windows, prefixe `MSYS_NO_PATHCONV=1`, senão o valor vira `C:/Program Files/Git/api` e o login falha com "Sem conexão com o servidor"): o `vercel.json` reescreve `/api/*` para a API no Railway.
- O Sandbox só aparece em dev ou com `VITE_SHOW_DEV_TOOLS=true`; no build de produção a página sai do bundle.
- Passo a passo do deploy e decisões de cookie/proxy: `infra/railway/README.md` (seção "Sistema web").
