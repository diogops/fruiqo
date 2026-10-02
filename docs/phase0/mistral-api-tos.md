# Mistral AI API: avaliação de termos para a etapa "interpretar o pedido" do "O que assistir hoje?"

Acesso a todas as fontes: 2026-10-02. Escopo: UMA etapa (`planRequest`, hoje no `AI_TONIGHT_PLAN_MODEL` = Haiku 4.5), que passaria ao modelo `mistral-large-latest` em `api.mistral.ai` (endpoint `/v1/chat/completions`). Enviado: SÓ o texto que o próprio usuário digitou (ex.: "suspense nórdico, história real"), delimitado como dado não confiável, sem `tools`. Fora: dados do TMDB, histórico, perfil, nomes de títulos do usuário. Saída: plano JSON com enums próprios (gêneros, atributos, década, origem, obras de referência), validado por schema (fail-closed).

Método de leitura: as páginas de `legal.mistral.ai`, `help.mistral.ai` e `docs.mistral.ai` foram lidas por ferramenta de fetch com resumo automático (não conferido por humano). Onde o resumo não trouxe o trecho (Privacy Policy, Trust Center), está marcado NÃO VERIFICADO. A página `docs.mistral.ai/admin/monitor-comply/privacy-data-controls` retornou 404.

## 1. Veredito

| Cenário | Veredito | Motivo |
|---|---|---|
| SC-PERSONAL | **GO com condições** (condicionado à condição 1: conta de organização) | Termos comerciais proíbem uso pessoal/não profissional da API; a conta precisa ser de uma organização/entidade, ou o uso é irregular. Cumprido isso: retenção de 30 dias com ZDR disponível, opt-out de treino por toggle, endpoint UE existe, DPA com SCCs, texto do pedido sem dado TMDB. Sem a condição 1, é NO-GO. |
| SC-STORE (público) | **NO-GO** (fail-closed) | PEND-10 (LGPD, transferência internacional) e C-15/TMDB abertas; sem mecanismo LGPD art. 33 verificado (DPA cita GDPR/SCCs módulo 4, não a ANPD); Privacy Policy e subprocessadores não verificados; usuários finais do app são "End Users" cujos consentimentos são responsabilidade do cliente (§1.4); texto de humor pode ser dado sensível. |

Esta avaliação cobre só a etapa de interpretação do pedido. Não cobre o gerador de títulos nem "Como estou".

## 2. Achados (Mistral)

| # | Tema | Achado (parafraseado) | URL oficial | Status |
|---|---|---|---|---|
| M-1 | Quem pode usar a API | Mistral AI Studio e o acesso às APIs são limitados a clientes empresariais; os termos de consumidor (ROW §1) excluem expressamente Studio/API e mandam quem integra a Mistral a produtos próprios distribuídos a usuários finais para os Commercial Terms. | https://legal.mistral.ai/terms/row-consumer-terms/ | Verificado (resumo de leitura direta) |
| M-2 | Cliente = organização | Commercial Terms §1.4: "Customer" é a organização/entidade que o signatário representa; uso pessoal/não profissional não é coberto (indivíduos vão aos termos de consumidor). Vigência 2026-09-25. | https://legal.mistral.ai/terms/commercial-terms-of-service/ | Verificado. **Conflito com SC-PERSONAL** (ver 5) |
| M-3 | Plano gratuito | Busca oficial indica plano Free com acesso ao Studio e US$ 10/mês de créditos, mas o texto M-1 diz que API é só empresarial. Duas leituras: A) conta Free com o Studio vale para qualquer pessoa, sob os termos que ela aceitar; B) API é só para empresa e conta de pessoa física não pode usar. | https://legal.mistral.ai/terms/commercial-terms-of-service/ e https://docs.mistral.ai/deployment/laplateforme/pricing | **AMBÍGUO**; tratar como B |
| M-4 | Treino (contrato) | Mistral não treina com Customer Data, exceto: (1) opt-in em produtos "opt-out", (2) cliente que não saiu em produtos "opt-in", (3) feedback, (4) modelos Labs/Preview (treino automático, sem opt-out). §4.2-4.3. | https://legal.mistral.ai/terms/commercial-terms-of-service/ | Verificado. Qual categoria a API pay-as-you-go ocupa não está explícito: **AMBÍGUO** |
| M-5 | Treino (help center) | Plano gratuito do Studio: Mistral "pode usar" entrada e saída para treino, com opt-out a qualquer momento; pay-as-you-go: cliente pode sair a qualquer momento; Enterprise: sai por padrão. Feedback (polegar/comentário) autoriza uso mesmo assim. Leitura segura: tratar como TREINA POR PADRÃO até o toggle estar desligado. | https://help.mistral.ai/en/articles/347617-do-you-use-my-user-data-to-train-your-artificial-intelligence-models | Verificado |
| M-6 | Como sair do treino | Admin (admin.mistral.ai) > Privacy > seção "Anonymous improvement data" > desligar o toggle. Os toggles de Vibe e de API são separados; é preciso desligar o da API. | https://help.mistral.ai/en/articles/455207-can-i-opt-out-of-my-input-or-output-data-being-used-for-training | Verificado |
| M-7 | Retenção padrão | Nas APIs (salvo exceções), Mistral guarda entrada e saída pelo tempo necessário para gerar a resposta e depois por 30 dias corridos para monitorar abuso, a menos que ZDR esteja ativo. (Fonte: resumo de busca oficial; a página do help center de retenção não foi aberta diretamente.) | https://help.mistral.ai/en/collections/789667-data-governance e https://docs.mistral.ai/admin/monitor-comply/zero-data-retention | Verificado por resumo; leitura direta pendente |
| M-8 | Zero Data Retention | ZDR vale só para planos pagos e chamadas stateless (inclui `/v1/chat/completions`), em todos os modelos exceto Labs; exclui Agents, Batch, Conversations, Libraries, Files. Pedido por contato com o suporte, com justificativa; Mistral pode negar; depois de aprovado aparece em Admin > Privacy. Obrigação legal e monitoramento de abuso podem se sobrepor. ZDR e opt-out de treino são controles independentes. | https://docs.mistral.ai/admin/monitor-comply/zero-data-retention e https://help.mistral.ai/en/articles/347612-can-i-activate-zero-data-retention-zdr | Verificado. Aprovação NÃO garantida |
| M-9 | Localização | Help center: dados guardados na UE por padrão; endpoint dos EUA só se escolhido. Regional inference: três endpoints, global `api.mistral.ai` ("sem compromisso regional"), UE `api.eu.mistral.ai` (data centers na UE/EFTA), EUA `api.us.mistral.ai`; custo 1,1x; só modelos hospedados na região; dados de plano de controle (conta, chaves, cobrança, analytics) podem ficar fora da região. | https://help.mistral.ai/en/articles/347629-where-do-you-store-my-data-or-my-organization-s-data e https://docs.mistral.ai/inference/regional-inference | Verificado. **AMBÍGUO**: "UE por padrão" (armazenamento) x endpoint global "sem compromisso" (processamento). Exigir `api.eu.mistral.ai` |
| M-10 | Transferência para fora da UE | Dado pode ser transferido temporariamente para fora da UE conforme os recursos usados, para subprocessadores no Trust Center; salvaguardas: contratos com garantias do art. 46 GDPR e SCCs da Comissão Europeia; avaliações extras (ZDR/criptografia) em subprocessadores fora da UE. | https://help.mistral.ai/en/articles/347629-where-do-you-store-my-data-or-my-organization-s-data | Verificado |
| M-11 | DPA | Cliente é controlador e Mistral operadora (§2.1); transferências para países com adequação da UE, ou SCCs módulo 4 (§8); para cliente fora do EEE em "Restricted Country" as SCCs são incorporadas automaticamente (§8.2); lei francesa; subprocessadores em lista pública com aviso por e-mail e 10 dias para objetar (§7); dados inacessíveis até 30 dias após o fim (§10.1); Exhibit 1 declara categorias especiais de dados como "None". Vigência 2026-07-27. Brasil/LGPD/ANPD não são citados no resumo. Aplica-se quando a Mistral age como operadora (Commercial Terms §12.3). | https://legal.mistral.ai/terms/data-processing-addendum | Verificado por resumo. LGPD art. 33: **AMBÍGUO** (leitura A: SCCs UE + garantias contratuais bastam como "cláusulas contratuais específicas"; leitura B: sem cláusulas-padrão da ANPD e sem adequação Brasil-UE, falta mecanismo). Tratar como B |
| M-12 | Dados sensíveis | Exhibit 1 do DPA declara "None" para categorias especiais: o contrato não prevê tratamento de dado sensível. Enviar texto que revele saúde mental contraria a premissa do DPA. | https://legal.mistral.ai/terms/data-processing-addendum | Verificado por resumo |
| M-13 | Usage Policy | Vigência 2026-06-11. Proíbe, entre outros, conteúdo que promova/instrua autolesão ou suicídio, CSAM, violação de privacidade/uso de imagem ou voz de terceiros, desinformação deliberada. Nada que proíba interpretar pedido de filmes. Não cobre decisão automatizada, divulgação de uso de IA nem atribuição. | https://legal.mistral.ai/terms/usage-policy | Verificado por resumo |
| M-14 | Usuário final e idade | §1.4: o cliente responde pelos atos dos End Users, mantém restrições equivalentes às da Usage Policy e obtém os consentimentos necessários. §2.2(c): proíbe incluir dados pessoais de menores de 13 anos (ou da idade de consentimento digital aplicável) como Customer Data. Termos de consumidor: idade mínima 13 anos com consentimento dos pais. | https://legal.mistral.ai/terms/commercial-terms-of-service/ | Verificado. Nada impede enviar texto de usuário final, desde que o cliente garanta consentimento e idade |
| M-15 | Atribuição e marca | Nenhuma exigência de "powered by". Nenhuma das partes usa nome/logos da outra sem aprovação escrita (§14.4). Proibido afirmar que saída de IA foi gerada por humano (§3.2). | idem | Verificado. Não colocar logo Mistral no app sem aprovação |
| M-16 | Uso comercial | Termos comerciais permitem uso comercial; cliente é dono da saída (cessão, §3.1). Restrição de saída só para imagens (§3.3). Sem SLA (§7.4); saída pode ser imprecisa e deve ser verificada (§3.5). | idem | Verificado |
| M-17 | Mudança unilateral e suspensão | Mudanças materiais com 30 dias de aviso; outras valem de imediato (§13); suspensão imediata em quebra, falta de pagamento ou risco sério (§11.3). Sem restrição explícita ao Brasil (§14.13 só lista sanções a Cuba, Irã, Coreia do Norte, Síria, Crimeia/Donetsk/Luhansk). | idem | Verificado |
| M-18 | Modelo | `mistral-large-latest` é alias móvel. A ficha de Mistral Large 3 (v25.12, 2025-12-02) mostra US$ 0,5 / US$ 1,5 por milhão de tokens in/out, contexto 256k, suporte a structured outputs. A página oficial consultada não confirma para qual versão o alias aponta hoje nem datas de descontinuação. | https://docs.mistral.ai/models/model-cards/mistral-large-3-25-12 | Preço/estrutura verificados; **alias NÃO VERIFICADO** |
| M-19 | Privacy Policy | O fetch devolveu só navegação. Nada afirmado sobre controlador, retenção na plataforma, transferências ou idade. | https://legal.mistral.ai/terms/privacy-policy/ | **NÃO VERIFICADO** (= proibido até prova) |
| M-20 | Subprocessadores e Trust Center | O fetch não trouxe a lista (nomes, finalidades, países) nem certificações. | https://trust.mistral.ai | **NÃO VERIFICADO** |

## 3. TMDB: a troca de provedor afeta a etapa?

Fonte: https://www.themoviedb.org/api-terms-of-use (análise registrada em `docs/phase0/openai-api-tos.md` §3, acesso 2026-10-01) e `docs/phase0/tmdb-consulta-C15.md`. Não reabri o termo do TMDB nesta rodada.

- A restrição do TMDB §1.C é por tipo de uso (ML/IA), não por fornecedor. A etapa avaliada só envia o texto digitado pelo usuário; nenhum Conteúdo TMDB entra no prompt (ARB-REQ-06). O risco do TMDB nesta etapa é o mesmo da D-25 com Haiku e não aumenta com a Mistral.
- Atenção à saída: o plano devolve "obras de referência" como texto escolhido pelo modelo a partir do que o usuário digitou. Elas são conferidas depois no TMDB, o que é o fluxo atual. Não passar à Mistral o título oficial do TMDB (D-28 vale só para o gerador de títulos, Anthropic/OpenAI). Se o título oficial for enviado à Mistral, é nova decisão.
- SC-STORE: §2.A do TMDB (LLM/chatbot como gatilho de licença comercial) e C-15 seguem abertos; a Mistral não muda isso.

## 4. Condições obrigatórias (SC-PERSONAL)

Todas verificáveis antes de ligar:

1. Conta de **organização** na Mistral (entidade em nome da qual o dono assina os Commercial Terms, M-2), não conta de pessoa física/consumidor. Evidência: tela Admin com nome da organização e aceite dos Commercial Terms. Se o dono não tiver entidade e a Mistral não confirmar por escrito que uso pessoal da API é aceito, a etapa volta a NO-GO.
2. Aceite de risco explícito do dono em nova decisão (D-xx). D-25/D-26 cobrem só Anthropic e OpenAI. Sem isso, nenhum envio.
3. Toggle de treino da **API** desligado em admin.mistral.ai > Privacy > "Anonymous improvement data" (M-6), com captura de tela datada guardada pelo dono. Conferir também que o toggle de Vibe não é o único desligado.
4. Plano **pago** (pay-as-you-go), não o Free, e nenhum modelo Labs/Preview (M-4, M-8). Pedir ZDR (M-8) e registrar a resposta; se negado, aceitar o risco dos 30 dias na decisão do item 2.
5. Endpoint **UE** explícito: `MISTRAL_BASE_URL=https://api.eu.mistral.ai` (ou `server="eu"`). Proibido usar o endpoint global ou o dos EUA para esta etapa (M-9). Antes de ligar, confirmar que `mistral-large-*` é servido no endpoint UE (a doc diz que cada região só serve os modelos hospedados nela).
6. Modelo **fixado por versão** (não `mistral-large-latest` em produção): o alias móvel pode mudar comportamento, preço e política sem aviso (M-18). Se o dono preferir o alias, registrar o aceite e rodar o eval a cada mudança.
7. Chave Mistral só no backend (SEC-REQ-10), fora de logs e do app/web.
8. Só `/v1/chat/completions` stateless, sem `tools`, sem Agents/Conversations/Libraries/Files/Batch (não elegíveis a ZDR, retêm estado), sem feedback de qualidade enviado à Mistral (M-5).
9. Prompt limitado ao texto digitado, delimitado como não confiável; nada do TMDB/Spotify/Open Library, nada de histórico, perfil, nomes de títulos do usuário ou texto de OCR. Estender o `d07-guard` para o novo cliente. `max_tokens` limitado; saída validada por `LlmExtractionSchema`-equivalente do plano; falha, recusa ou formato inválido caem no parser local ou no Haiku (fail-closed).
10. Consentimento individual D-08 (`ai_consent`), `TMDB_AI_CLEARANCE=confirmed` (D-07), cota diária, `detectRisk` ANTES do envio (se o pedido tem sinal de risco, não vai à Mistral) e texto nunca persistido nem logado (RNF-06).
11. Cliente embrulhado em `trackingClient`/`withAiUsage` (custo em `ai_usage`, preços em `ai-usage/usage.ts`) e redaction de logs.
12. Atualizar a política de privacidade pública (`/privacidade`) e o aviso de IA citando a Mistral AI (França) como operadora, a região UE e a transferência internacional. Registrar a Mistral no inventário de operadores (TOS-REQ-56).
13. Não ligar antes de: ler a Privacy Policy (M-19), abrir a lista de subprocessadores no Trust Center (M-20) e confirmar a retenção na página oficial do help center (M-7). Se algum impedir o caso, volta a NO-GO.

## 5. LGPD (resumo desta etapa)

| Dado | Titular | Finalidade | Base legal sugerida | Retenção sugerida | Transferência internacional | Risco |
|---|---|---|---|---|---|---|
| Texto do pedido digitado ("suspense nórdico, história real"; pode conter humor/estado emocional se o usuário escrever) | Dono (único titular em SC-PERSONAL) | Traduzir o pedido em plano de busca | Consentimento (art. 7º, I) via `ai_consent`; execução do serviço solicitado como apoio | Mistral: 30 dias de monitoramento de abuso, ou zero com ZDR; no Fruiqo: nada persistido (RNF-06) | Brasil -> Mistral AI (França) com endpoint UE; subprocessadores podem estar fora da UE (M-10). Art. 33: mecanismo AMBÍGUO (SCCs UE, sem cláusulas-padrão ANPD); tratar como B | Baixo em SC-PERSONAL com aceite do titular; texto de humor pode ser dado sensível (art. 11, saúde): DPA declara não prever categorias especiais, então `detectRisk` e minimização são obrigatórios |
| Plano JSON devolvido (enums próprios) | Dono | Alimentar a busca local | Mesma base | Não persistir; descartar após o pedido | Retorno da mesma chamada | Baixo; é derivado de texto do usuário, sem dado TMDB |
| Chave de API e metadados da chamada | Operador (dono) | Autenticação e cobrança | Legítimo interesse/execução de contrato | Segredo no Railway; sem log | Dados de conta/cobrança fora da região escolhida (M-9) | Baixo |
| SC-STORE: texto de milhares de usuários finais | Terceiros | Idem | Consentimento específico e destacado (art. 11, I, se sensível) | ZDR obrigatório | Sem mecanismo LGPD verificado | **Alto**; NO-GO |

## 6. Obrigações derivadas (novos requisitos)

O maior TOS-REQ existente em `docs/phase0` é o TOS-REQ-75 (`tos-report-imdb-ratings.md`); os novos começam em 76.

| ID | Plataforma de origem | Requisito |
|---|---|---|
| TOS-REQ-76 | P-MISTRAL | A conta da API deve pertencer a uma organização que aceitou os Commercial Terms (M-1/M-2); sem isso, a Mistral não liga. Guardar a evidência na decisão correspondente. |
| TOS-REQ-77 | P-MISTRAL | Toggle de treino da API desligado e plano pago, sem modelos Labs/Preview; conferir antes de ligar e reconferir a cada mudança de plano (M-4, M-6). |
| TOS-REQ-78 | P-MISTRAL | Usar só o endpoint UE (`MISTRAL_BASE_URL=https://api.eu.mistral.ai`); o backend recusa subir com `AI_TONIGHT_PLAN_PROVIDER=mistral` se a URL base não for a da UE. |
| TOS-REQ-79 | P-MISTRAL | Só chat completions stateless, sem `tools` e sem Agents/Conversations/Libraries/Files/Batch; sem envio de feedback de qualidade à Mistral. |
| TOS-REQ-80 | P-MISTRAL | Modelo fixado por versão no env (`MISTRAL_PLAN_MODEL`), sem `*-latest` em produção sem aceite registrado; `d07-guard` estendido ao cliente Mistral. |
| TOS-REQ-81 | P-MISTRAL / P-LGPD | Pedido passa por `detectRisk` antes do envio; sinal de risco não vai ao provedor; texto do pedido não é persistido nem logado. |
| TOS-REQ-82 | P-MISTRAL / P-LGPD | Atualizar a política de privacidade e o inventário de operadores (TOS-REQ-56) com a Mistral AI, região UE e transferência internacional, antes de ligar. |
| TOS-REQ-83 | P-MISTRAL | Solicitar ZDR (M-8) e registrar o resultado; reavaliar a decisão se negado. |
| TOS-REQ-84 | P-MISTRAL | Não exibir nome/logo da Mistral no app sem aprovação escrita (§14.4); não afirmar que a saída da IA foi feita por humano (§3.2). |
| TOS-REQ-85 | P-MISTRAL | Monitorar mudanças nos Commercial Terms (vigência 2026-09-25), DPA (2026-07-27) e Usage Policy (2026-06-11); mudanças materiais têm só 30 dias de aviso (§13). |

## 7. Pendências

| Item | Risco | Para resolver |
|---|---|---|
| Elegibilidade do dono pessoa física (M-1/M-2/M-3) | Uso da API fora dos termos; suspensão imediata (§11.3) | Abrir a API como organização (ex.: empresa/MEI, se aceita) ou pedir confirmação escrita ao suporte da Mistral; parecer jurídico |
| Treino por padrão na API pay-as-you-go (M-4/M-5) | Texto do pedido treinar modelo se o toggle não for desligado | Desligar o toggle e guardar evidência; pedir confirmação escrita do padrão da conta |
| Processamento na UE x endpoint global (M-9) | Dado processado fora da UE | Usar `api.eu.mistral.ai`; confirmar disponibilidade do modelo na região e o que sai da região (plano de controle) |
| Transferência internacional LGPD art. 33 (M-11) | Sem cláusulas-padrão da ANPD nem adequação Brasil-UE verificada | Parecer jurídico; pedir à Mistral adendo para LGPD; ZDR + minimização |
| Privacy Policy, subprocessadores, Trust Center (M-19/M-20) | Cláusulas e países de subprocessamento não lidos | Dono abrir as páginas no navegador e registrar aqui |
| Retenção de 30 dias (M-7) | Texto do pedido guardado até 30 dias na UE | ZDR (aprovação da Mistral) ou aceite de risco |
| Alias `mistral-large-latest` (M-18) | Mudança silenciosa de modelo/preço | Fixar versão; reconferir preço e disponibilidade antes de ligar |
| Dado sensível (art. 11) | Pedido pode revelar saúde mental; DPA diz "None" para categorias especiais | `detectRisk`, minimização, consentimento específico; reavaliar antes de SC-STORE |
| TMDB §1.C/§2.A | Mesmo risco da D-17; sem resposta escrita | Consulta C-15 |
| SC-STORE | Multiusuário, End Users, PEND-10 aberta | Parecer jurídico, DPA assinado, consentimento do titular, ZDR, resposta escrita do TMDB |

Este relatório não constitui parecer jurídico.
