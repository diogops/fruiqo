# Sign in with Google (GIS, ID token): avaliação de ToS

Data de acesso de todas as fontes: 2026-10-01. Escopo avaliado: openid, email, profile; fluxo de ID token validado no backend; sem access token e sem API do Google. Método: fail-closed (ARB-REQ-03); trechos parafraseados.

## Veredito

| Cenário | Veredito |
|---|---|
| SC-PERSONAL | **GO com condições** |
| SC-STORE | **GO com condições** (mesmas condições; a verificação de marca é recomendada, não exigida pelos escopos básicos) |

## Achados

1. **Verificação do app não é obrigatória só com escopos básicos.** Apps que usam apenas escopos não sensíveis (openid, email, profile) não precisam completar a verificação; só a verificação de marca é necessária para exibir nome/logo próprios na tela de consentimento. Fonte: https://support.google.com/cloud/answer/13463073
2. **Testing x In production.** Em "Testing" (usuário externo), o refresh token expira em 7 dias, exceto quando os escopos pedidos são só nome, e-mail e perfil. Fonte: https://developers.google.com/identity/protocols/oauth2#expiration. O teto de 100 usuários de teste e a tela de "app não verificado" **não foram confirmados** em página oficial nesta sessão: NÃO VERIFICADO. Como o Fruiqo não usa refresh token do Google, o efeito prático é baixo, mas o app deve ficar "In production" para qualquer usuário fora da lista de teste (inferência, ver pendências).
3. **Requisitos de produção** (OAuth): política de privacidade linkada na home do app, em domínio verificado que o dono controla; home pública descrevendo a função, com links para política e termos; HTTPS nas origens JS; domínios verificados no Search Console; contato atualizado no IAM; projeto Cloud separado do de desenvolvimento. Fonte: https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance
4. **Google API Services User Data Policy** (atualizada 15/02/2024): exige política de privacidade que documente o uso dos dados, divulgação clara, pedir só escopos necessários (sem "uso futuro hipotético"), e Limited Use (não vender/transferir dados a terceiros ou data brokers; acesso humano só com consentimento, segurança ou obrigação legal). Fonte: https://developers.google.com/terms/api-services-user-data-policy. AMBÍGUO: a política é voltada a dados obtidos por APIs do Google; se o ID token (nome, e-mail, foto) está no escopo dela é discutível. Leitura conservadora adotada: aplicar. Isso colide com o envio de dados do usuário a LLM de terceiros (ver condição 8).
5. **Google APIs Terms of Service**: obrigação de ter e cumprir política de privacidade que descreva coleta e compartilhamento; proibido mascarar a identidade do cliente ou sugerir parceria/endosso do Google sem autorização escrita; Google pode suspender o acesso sem aviso se entender que há violação. Fonte: https://developers.google.com/terms
6. **Marca do botão** (obrigatória para verificação do app): usar o botão do GIS é o caminho recomendado (mantém conformidade); textos permitidos "Sign in with / Sign up with / Continue with Google" (localizáveis); temas claro/escuro/neutro, formas retangular/pílula; o "G" colorido não pode ser alterado nem usado sem texto/borda, nem em versão monocromática ou só com a palavra "Google"; o botão deve ter destaque no mínimo igual ao de outras opções de login de terceiros. Fonte: https://developers.google.com/identity/branding-guidelines
7. **Validação do ID token**: conferir `aud` = client ID do Fruiqo, `iss` = accounts.google.com (com ou sem https://) e `exp`; usar `sub` (único e nunca reutilizado) como identificador, não o e-mail; checar `email_verified` e `hd`; usar biblioteca oficial/JWT; respeitar `Cache-Control` das chaves públicas (rotação). Fonte: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
8. **Escopos do YouTube (futuro)**: escopos sensíveis exigem revisão do Google antes de qualquer conta conceder acesso (verificação de marca, domínio, justificativa por escopo, vídeo de demonstração em inglês, ~3-5 dias úteis; exceções para uso pessoal/teste). Escopos restritos podem exigir avaliação de segurança anual por terceiro (Letter of Assessment). Fontes: https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification e a User Data Policy (item 4). **A classificação exata (sensível x restrito) de youtube.readonly / youtube / youtube.force-ssl NÃO foi confirmada** em página oficial nesta sessão: NÃO VERIFICADO, tratar como sensível no mínimo. Além disso, usar dados de conta do YouTube alimenta Limited Use e a regra do D-04/D-07 (nada vai a LLM sem desbloqueio) e exigiria nova avaliação ARB-REQ-03, nova auditoria da YouTube API (TOS-REQ-07) e reabertura da política de privacidade.

## Condições obrigatórias

- C1. Botão renderizado pelo SDK do GIS (ou idêntico ao padrão de marca), texto permitido, sem alterar o "G"; destaque igual ao de outros logins de terceiros.
- C2. Só openid, email, profile; sem escopo adicional, sem access token, sem chamada a API do Google.
- C3. Backend valida assinatura, `aud`, `iss`, `exp`, `email_verified` com biblioteca oficial e cache das chaves por `Cache-Control`; nenhuma decisão de confiança no cliente.
- C4. Não persistir o ID token nem nenhum token do Google; guardar só e-mail, `sub` (vínculo, chave de conta, não o e-mail) e, se aceito, nome para sugerir o nome de exibição (a foto não é guardada). Logs sem JWT (redaction do pino).
- C5. Política de privacidade (em português) publicada em domínio próprio verificado, linkada na home e na tela de consentimento OAuth, descrevendo Google como fonte, dados, finalidade, retenção e direitos LGPD. O domínio padrão `fruiqo-web.vercel.app` não é domínio do dono: para a verificação de marca/produção, usar domínio próprio (ou aceitar que o branding fique sem verificação). NÃO VERIFICADO se `vercel.app` é aceito pelo Search Console como domínio verificável.
- C6. Consent screen em "In production" com projeto Cloud separado do de desenvolvimento, contato atualizado, origens HTTPS.
- C7. Os dados vindos do Google (nome, e-mail, `sub`) nunca vão a LLM, a analytics ou a terceiros (Limited Use; já coerente com D-04/D-07/D-08).
- C8. Sem texto sugerindo parceria ou endosso do Google.
- C9. Sem vender, transferir ou usar o perfil Google para publicidade.

## LGPD (resumo; ver tos-report.md, seção 4)

- Dados: e-mail, `sub`, nome (opcional). Finalidade: autenticação e vínculo de conta. Base sugerida: execução de contrato / procedimentos preliminares (art. 7º, V); consentimento é opcional para o nome. Minimização: não guardar foto nem tokens. Retenção: enquanto a conta existir; exclusão com a conta. Transferência internacional: Google (EUA) é o provedor da identidade, por iniciativa do titular; informar na política (art. 33). Direitos (art. 18): acesso, correção, eliminação, e meio de desvincular o Google.
- Fonte legal primária (Lei 13.709/2018, planalto.gov.br) citada de forma conhecida, mas não buscada nesta sessão: conferir no parecer.

## Riscos residuais

- Suspensão do client ID pelo Google sem aviso (ToS); mitigar mantendo login por e-mail/senha como alternativa.
- Ambiguidade da aplicação da User Data Policy a dados de ID token (item 4).
- Mudança do botão/branding pelo Google: usar o SDK reduz o risco.
- Troca de e-mail na conta Google: vincular por `sub`, não por e-mail; risco de tomada de conta se vincular automaticamente por e-mail sem `email_verified`.
- SC-STORE: lojas podem exigir exibir login equivalente ou exclusão de conta dentro do app (Apple/Google Play), NÃO VERIFICADO aqui (fora do escopo).

## Pendências

- Confirmar em página oficial: teto de 100 usuários e comportamento "Testing" para login básico; classificação dos escopos do YouTube; aceitação de domínios vercel.app.
- Parecer jurídico sobre art. 33 LGPD e política de privacidade.

Este relatório não constitui parecer jurídico.
