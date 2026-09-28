---
description: Executa a Fase 0 (discovery de ToS, segurança e conectividade) com os subagentes e para no checkpoint de aprovação
argument-hint: [foco opcional, ex.: "só Spotify e Instagram" ou "priorizar SC-PERSONAL"]
---

Execute a Fase 0 do projeto. Foco adicional informado: $ARGUMENTS

1. Confirme que `docs/phase0/platforms.md` existe. Se não existir, pare e avise.
2. Em paralelo, delegue:
   - ao subagente `tos-compliance-auditor` → `docs/phase0/tos-report.md`
   - ao subagente `integration-feasibility-scout` → `docs/phase0/integration-feasibility.md`
3. Quando os dois terminarem, delegue ao `security-threat-modeler` (ele usa o relatório de viabilidade para saber quais fluxos de auth/deep link serão reais) → `docs/phase0/security-threat-model.md`.
4. Se o scout tiver executado algum spike contra plataforma que o tos-report marcou como `PROIBIDO` ou `NÃO VERIFICADO`, registre isso como incidente no topo da resposta.
5. Delegue ao `phase0-arbiter` → `docs/phase0/decision-matrix.md`.
6. Responda com:
   - tabela resumo da matriz de decisão (uma linha por plataforma, pior status em cada cenário)
   - as decisões que preciso tomar (seção 6 do arbiter)
   - os testes manuais em device que preciso executar

**Não inicie a Fase 1, não escreva código de produção e não altere a spec.** Pare e aguarde minha aprovação explícita.
