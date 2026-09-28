# Wireframes v2

ASCII de baixa fidelidade. Os rótulos são em português. Os IDs entre colchetes apontam para os requisitos em `delta-v2.md`.

## 1. App: home com os 3 modos [RF-31, RF-32, RF-33]

```
┌──────────────────────────────────────┐
│ Fruiqo                      ⚙ Ajustes│
├──────────────────────────────────────┤
│ ▶ CONTINUAR                  [RF-31] │
│ ┌──────────────────────────────────┐ │
│ │ 12 filmes que você PRECISA ver   │ │
│ │ ███████░░░░░  7/12               │ │
│ │ Próximo: Vidas Passadas (2023)   │ │
│ │ ● no seu Prime Video             │ │
│ │ [ Assistir agora ]  [ Pular ]    │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ✨ ME SURPREENDA            [RF-32]  │
│ (Comédia romântica) (Comédia        │
│  pastelão) (Thriller psicológico)    │
│ (Pra chorar) (Conforto) (Ver todos ›)│
│                                      │
│ 💬 COMO ESTOU?              [RF-33]  │
│ ┌──────────────────────────────────┐ │
│ │ Conte como você está…            │ │
│ └──────────────────────────────────┘ │
│ 🔒 Seu texto não fica salvo. Saiba + │
│                    [ Me sugerir ]    │
├──────────────────────────────────────┤
│  🏠 Início   📥 Recebidos   📚 Listas│
└──────────────────────────────────────┘
```

Estados:
- Sem opt-in de humor: a caixa "Como estou?" vira o botão "Ativar sugestões por humor" (RNF-06).
- `AI_MODE=off`: esconde o modo 3; `rules` funciona sem IA.

## 2. App: resultado de recomendação [RF-35, RF-36, RF-37, RF-38]

```
┌──────────────────────────────────────┐
│ ← Pra você agora                     │
│ Entendi: algo inspirador, leve, sem  │
│ romance no centro. (editar filtros)  │
├──────────────────────────────────────┤
│ ┌──────┐ Pequena Miss Sunshine (2006)│
│ │poster│ Comédia · Drama · 1h41      │
│ │      │ ● no seu Netflix            │
│ └──────┘ Por que: história de        │
│   recomeço, tom leve, parecido com   │
│   "Aftersun" que você curtiu         │
│   [✓ Vou ver]  [↷ Pular]  [↻ Outra]  │
├──────────────────────────────────────┤
│ ┌──────┐ Soul (2020)   FORA DA SUA   │
│ │poster│ Animação · 1h40   LISTA     │
│ └──────┘ Por que: …   [+ Minha lista]│
├──────────────────────────────────────┤
│ Pular por quê? (pesado demais)       │
│ (longo demais) (já vi) (não é o mood)│
│ Dados de filmes: TMDB (atribuição)   │
└──────────────────────────────────────┘
```

Desvio de risco [RNF-07]:

```
┌──────────────────────────────────────┐
│ 💛 Obrigado por contar como está.    │
│ Parece que você está passando por um │
│ momento muito difícil. Você não      │
│ precisa passar por isso sozinho(a).  │
│                                      │
│ CVV: ligue 188 (24h, gratuito)       │
│ ou converse em cvv.org.br            │
│ Em emergência: SAMU 192              │
│                                      │
│ [ Ligar 188 ]  [ Abrir cvv.org.br ]  │
│        ( quero continuar mesmo assim )│
└──────────────────────────────────────┘
```

## 3. Web/sandbox: pipeline inspector [RF-19, RF-27]

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Share 493e… · Prints (2) · done · mode=mock · fixture: lista-sobreposicao │
├────┬──────────────┬───────┬──────────┬────────────────────────────────────┤
│ #  │ Etapa        │ ms    │ custo    │ Saída (resumo)                     │
├────┼──────────────┼───────┼──────────┼────────────────────────────────────┤
│ 1  │ normalize    │ 2     │ —        │ origin=screenshot, pages=2         │
│ 2  │ noise_filter │ 1     │ —        │ -6 linhas (Seguir, Curtido por…) ▸ │
│ 3  │ merge_pages  │ 1     │ —        │ -3 linhas sobrepostas            ▸ │
│ 4  │ extract      │ 3     │ $0.0000  │ 12 candidatos (heuristic)        ▸ │
│ 5  │ dedup        │ 4     │ —        │ 0 páginas ignoradas, 3 já na lista │
│ 6  │ resolve      │ 812   │ —        │ 9 tmdb, 0 spotify, 0 falhas      ▸ │
│ 7  │ decide       │ 1     │ —        │ 8 catalog., 1 revisão, 0 descart.  │
├────┴──────────────┴───────┴──────────┴────────────────────────────────────┤
│ Candidatos                                   conf.  decisão    ação       │
│ Oppenheimer (2023) → tmdb:<id>                0.60   catalog.   [trocar]   │
│ Zona de Interesse (2023) → —                 0.45   revisão    [resolver] │
│ Esperado (expected.json): 12/12 ✓  kind 12/12 ✓  tmdb 11/12 ✗ (diff ▸)    │
└───────────────────────────────────────────────────────────────────────────┘
```

## 4. Web: catálogo [RF-24, RF-25, RF-26]

```
┌──────────────┬────────────────────────────────────────────────────────────┐
│ FRUIQO       │ Catálogo (312)        🔎 buscar…          [+ Adicionar]    │
│ ▸ Catálogo   ├────────────────────────────────────────────────────────────┤
│   Revisão (4)│ Tipo[Filme▾] Gênero[Todos▾] Status[Quero ver▾]             │
│   Listas     │ Prioridade[Todas▾] Lista[Todas▾] Fonte[Todas▾]  ↕ Prioridade│
│   Recebidos  ├──┬───────────────────────┬────┬──────────┬─────┬────┬──────┤
│   Perfil     │☐ │ Título                │Ano │Gêneros   │Stat.│Prio│Onde  │
│   Sandbox*   ├──┼───────────────────────┼────┼──────────┼─────┼────┼──────┤
│              │☑ │ Vidas Passadas        │2023│Drama,Rom.│Quero│ ●●●│Prime │
│ * só dev     │☑ │ Aftersun              │2022│Drama     │Visto│ ●● │Mubi  │
│              │☐ │ A Baleia              │2022│Drama     │Quero│ ●  │—     │
│              ├──┴───────────────────────┴────┴──────────┴─────┴────┴──────┤
│              │ 2 selecionados: [Mover p/ lista▾][Status▾][Prioridade▾]    │
│              │                 [Gênero▾][Remover]   ↶ Desfazer (10s)      │
└──────────────┴────────────────────────────────────────────────────────────┘
```

Listas: painel à direita com os itens arrastáveis (`⋮⋮`), mais as ações Renomear, Duplicar e Fixar como "Continuar".

## 5. Web: fila de revisão [RF-28]

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Revisão · 4 pendentes                         Atalhos: A R E S J/K U ?    │
├───────────────────────────────────────────────────────────────────────────┤
│ ▶ "Zona de Interesse (2023)"   conf. 0.45   de: Prints 28/09              │
│   Contexto OCR: "…6. Zona de Interesse (2023) 7. Vidas…"                  │
│   Matches sugeridos:                                                      │
│    (1) The Zone of Interest (2023) · Drama/Guerra        ← [S] trocar     │
│    (2) Zona de Interesse (doc., 2019)                                     │
│   [A] Aprovar   [R] Rejeitar   [E] Editar título/tipo/ano   [U] Desfazer  │
├───────────────────────────────────────────────────────────────────────────┤
│   "Curtido por joao_silva"     conf. 0.20   → sugerido: rejeitar (ruído)  │
│   "Duna Parte 2"               conf. 0.40   → possível duplicata de       │
│                                               "Duna: Parte Dois" [M] merge│
└───────────────────────────────────────────────────────────────────────────┘
```

## 6. Web (e app): perfil de gosto editável [RF-29, RF-34, RNF-10]

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Seu perfil de gosto          (tudo que usamos para sugerir está aqui)     │
├───────────────────────────────────────────────────────────────────────────┤
│ Gêneros                 afinidade          por quê              ações     │
│ Drama                   ████████░░ +0.78   assistiu Aftersun…   📌 ✕ ⟲    │
│ Comédia romântica       ██████░░░░ +0.55   curtiu 3 títulos     📌 ✕ ⟲    │
│ Terror                  ██░░░░░░░░ −0.60   pulou 4 ("pesado")   📌 ✕ ⟲    │
│   ✕ excluído por você: nunca sugerir                                      │
├───────────────────────────────────────────────────────────────────────────┤
│ Tipo: Filmes 70% · Séries 30%     Duração preferida: ≤ 2h                 │
│ Meus streamings: [✓ Netflix] [✓ Prime Video] [ Disney+ ] [ Max ] [+]      │
│ Humor: ( ) lembrar meu humor   [Apagar histórico de humor]                │
│ [Recalcular perfil do zero]                                               │
└───────────────────────────────────────────────────────────────────────────┘
📌 fixar (+)  ✕ excluir  ⟲ zerar
```
