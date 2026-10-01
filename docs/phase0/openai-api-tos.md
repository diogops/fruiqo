# OpenAI API: avaliação de termos para o gerador de nomes do "O que assistir hoje?"

Acesso a todas as fontes: 2026-10-01. Escopo: UMA etapa (`tonight` em `taste-ai.ts`), Chat Completions, modelo `gpt-6.1-sol`. Enviado: pedido digitado, perfil declarado (humor, resumo, enums próprios de gênero/subgênero) e NOMES (título/ano) de favoritos, avaliados, fila e amostra de vistos (alguns normalizados pelo TMDB). Fora: sinopse, nota, capa, disponibilidade, gêneros aprendidos do TMDB. Saída: nomes, conferidos depois no TMDB.

## 1. Veredito

| Cenário | Veredito | Motivo |
|---|---|---|
| SC-PERSONAL | **GO com condições** | Sem treino por padrão na API, retenção de 30 dias, Brasil é país suportado, nada nos termos do TMDB distingue provedor de LLM. Pendências abaixo são aceitáveis só com aceite de risco do dono (como D-25). |
| SC-STORE (público) | **NO-GO** (fail-closed) | PEND-10 e C-15 abertas; termos de uso/Usage Policies/DPA não verificados por leitura direta; transferência internacional de dados de terceiros sem base verificada; TMDB sem resposta escrita. |

Ressalva: este relatório não verificou o conteúdo do Services Agreement, Usage Policies nem Business Terms por leitura direta (ver 5). Onde só houve snippet de busca, está marcado.

## 2. Achados (OpenAI)

| # | Tema | Achado (parafraseado) | URL oficial | Status |
|---|---|---|---|---|
| O-1 | Treino | Dados enviados à API não são usados para treinar/melhorar modelos, salvo opt-in explícito (política desde 2023-03). | https://developers.openai.com/api/docs/guides/your-data | Verificado (leitura direta) |
| O-2 | Treino (contrato) | O Services Agreement diz que Customer Content só é usado para prestar o serviço, cumprir lei, aplicar políticas e prevenir abuso; sem uso para melhorar o serviço sem concordância explícita; cliente é dono do Output. | https://openai.com/policies/services-agreement/ | Fonte oficial só via resultado de busca; página deu HTTP 403. Parcial |
| O-3 | Retenção | Logs de abuse monitoring (prompts, respostas, metadados) por até 30 dias por padrão; vale para `/v1/chat/completions` e para `gpt-6.1-sol`. Cache de prompt até 24 h. | https://developers.openai.com/api/docs/guides/your-data | Verificado |
| O-4 | Zero Data Retention | ZDR exclui conteúdo do abuse monitoring, mas exige aprovação da organização (Settings > Data controls); sem ZDR, os 30 dias valem. O default de `store` em Chat Completions não é afirmado na página. | idem | Verificado; default de `store` NÃO VERIFICADO |
| O-5 | Residência de dados | Armazenamento regional em várias jurisdições; processamento regional só US, Europa e UAE. Não há Brasil. Conclusão: dado sai do Brasil. | idem | Verificado |
| O-6 | País suportado | Brasil consta na lista de países/territórios com acesso à API. | https://developers.openai.com/api/docs/supported-countries | Verificado |
| O-7 | Modelo | `gpt-6.1-sol` existe (US$ 2 / US$ 10 por milhão de tokens in/out, contexto 1,05M). | https://developers.openai.com/api/docs/models | Verificado |
| O-8 | DPA / transferência | O DPA (v.010126) usa SCCs da UE e adequação da UE para transferências de dados EEE/Suíça. Não encontrei adendo específico para Brasil/LGPD (nem cláusulas padrão da ANPD) no PDF; a leitura foi por resumo automático, não conferida por humano. | https://openai.com/policies/data-processing-addendum/ e https://cdn.openai.com/pdf/openai-data-processing-addendum.pdf | AMBÍGUO. Leitura A: DPA cobre o cliente brasileiro por referência no Agreement. Leitura B: sem mecanismo LGPD art. 33 explícito. Tratar como B |
| O-9 | Usage Policies | Não consegui ler (HTTP 403). Não afirmo nada sobre proibições, menores ou dados sensíveis. | https://openai.com/policies/usage-policies/ | **NÃO VERIFICADO** (= proibido até prova) |
| O-10 | Boas práticas de segurança | Recomendam Moderation API gratuita, `safety_identifier` (id de usuário com hash), teste contra prompt injection e, se houver menores, guia Under-18. São recomendações, não condição contratual verificada. | https://developers.openai.com/api/docs/guides/safety-best-practices | Verificado (como recomendação) |

## 3. TMDB: impede enviar NOMES a um segundo provedor de LLM?

Fonte: https://www.themoviedb.org/api-terms-of-use (acesso 2026-10-01; última atualização do termo 2023-10-20) e `docs/phase0/tmdb-consulta-C15.md`.

- §1.C proíbe usar a API/Conteúdo TMDB "em conexão com" Aplicação baseada em ML/IA, sem citar provedor. A restrição é por tipo de uso, não por fornecedor. Trocar Anthropic por OpenAI não muda a análise; **também não a melhora**.
- §2.A trata uso com LLM/chatbot como gatilho de licença comercial. Em SC-STORE, mesmo gratuito, o risco sobe.
- §1.A: licença não sublicenciável; não vender/sublicenciar acesso ao Conteúdo. Enviar um título/ano a um processador (sem revenda, sem treino) não é sublicenciamento em leitura natural, mas o termo não trata de "processador" explicitamente. AMBÍGUO, baixo risco em SC-PERSONAL.
- Evidência favorável (D-17): staff do TMDB (Travis Bell, 2024-04-18) aprovou app gratuito com LLM+RAG em dados do TMDB. Resposta a terceiro, informal, sem análise de arquitetura. Vale como aceite de risco pessoal, não como autorização escrita. Consulta C-15 continua sem resposta (D-07).
- Nome normalizado pelo TMDB é Conteúdo TMDB (C-16/C-17). Mitigação: preferir a string de origem do usuário (como digitada/importada) a canônica do TMDB, quando possível.
- Conclusão: nada nos termos veda especificamente um segundo provedor; o risco é o mesmo da D-25. A garantia de "não treino" é mais forte do que o TMDB exige apenas se a OpenAI cumprir O-1/O-2 (condição, ver 4).

## 4. Condições obrigatórias (SC-PERSONAL)

1. Aceite de risco explícito do dono em nova decisão (D-xx), pois a D-25 cobre só a Anthropic. Sem isso, nenhum envio.
2. Consentimento individual D-08 (`user_settings.ai_consent`) e `TMDB_AI_CLEARANCE=confirmed` (D-07), cota diária e `LLM_REAL_CONTENT_ALLOWED` como hoje.
3. Chave OpenAI só no backend (SEC-REQ-10); nunca no app/web; fora de logs.
4. Sem `tools`, sem web search/file search/computer use, sem `/v1/files`, `/v1/vector_stores`, `/v1/threads`, `/v1/assistants`, `/v1/batches` (ZDR-ineligíveis, retêm estado). Só Chat Completions, `store: false` explícito (default não verificado).
5. Conteúdo tratado como dado não confiável (delimitado), saída validada por schema, `max_tokens` limitado, nomes conferidos no TMDB (fail-closed).
6. Conteúdo do prompt limitado ao descrito (enums próprios + nomes). Nada de sinopse, nota, capa, disponibilidade, gêneros aprendidos (estender o `d07-guard` para o novo cliente). Humor passa por `detectRisk` antes; texto livre de humor não persistido nem logado (RNF-06).
7. Cliente embrulhado em `trackingClient`/`withAiUsage` (custo em `ai_usage`) e redaction de logs.
8. Não ligar sem antes: ler Usage Policies (O-9) e confirmar o default de `store` (O-4). Se algum impedir o caso de uso, volta a NO-GO.
9. Opcional recomendado: `safety_identifier` com hash do user id; solicitar ZDR se elegível.
10. Atualizar a política de privacidade/aviso de IA (TOS-REQ-42) citando o novo operador e a transferência internacional.

## 5. Riscos residuais e pendências

| Item | Risco | Para resolver |
|---|---|---|
| Services Agreement, Usage Policies, Business Terms retornaram 403 ao fetch | Cláusulas não lidas diretamente (restrições de uso, idade mínima, atribuição de responsabilidade) | Dono ler as páginas no navegador e registrar aqui |
| Transferência internacional LGPD (art. 33) sem mecanismo verificado | Dado pessoal (perfil de gosto, humor) vai a servidores dos EUA/outros | Parecer jurídico; pedir à OpenAI adendo Brasil/SCCs ANPD; ou ZDR + minimização |
| Retenção de 30 dias fora do Brasil | Dados de gosto/humor ficam até 30 dias nos logs de abuso | ZDR (aprovação OpenAI) ou aceitar o risco em SC-PERSONAL |
| Resumo/humor pode ser dado sensível (LGPD art. 11) | Tratar como saúde mental indireta | Manter nome-only no prompt; evitar texto livre de humor no prompt; consentimento específico |
| TMDB §1.C/§2.A | Mesmo risco da D-17; sem resposta escrita | Enviar consulta C-15 |
| SC-STORE | Multiusuário, dados de terceiros, PEND-10 aberta | Parecer jurídico, DPA assinado, consentimento do titular, resposta escrita do TMDB, ZDR |
| Modelo | Nome `gpt-6.1-sol` lido na documentação; preço/disponibilidade podem mudar | Reconferir antes de ligar |

Este relatório não constitui parecer jurídico.
