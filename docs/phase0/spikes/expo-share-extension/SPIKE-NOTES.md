# SPIKE-13 — Expo + expo-share-extension (MaxAst) — prebuild

Objetivo: verificar se o plugin candidato alternativo `expo-share-extension` (repositório de MaxAst, citado como alternativa na pendência 19 / SPIKE-12) suporta Android, é compatível com o Expo SDK 57 (mesma versão do SPIKE-12) e se `npx expo prebuild` gera algo no host disponível (Windows).

Regras respeitadas: projeto separado de `docs/phase0/spikes/expo-share/`; nenhuma dependência instalada fora desta pasta; nenhum build assinado; nenhuma credencial/login Apple ou EAS; nada publicado; `node_modules` apagado ao final.

## Pesquisa (antes do spike)

- **Pacote npm oficial**: [`expo-share-extension`](https://www.npmjs.com/package/expo-share-extension) — confirmado via `registry.npmjs.org` (GET público, sem auth) que o repositório de origem é `MaxAst/expo-share-extension` no GitHub. Acessado em 2026-09-27.
- **Descrição do pacote** (campo `description` do `package.json` publicado): "Expo config plugin to create an iOS share extension." — confirma que é **um plugin iOS-only**, não Android. Fonte: `registry.npmjs.org/expo-share-extension` (spike, 2026-09-27).
- **Versões publicadas** (via `registry.npmjs.org`, 63 versões no total): última estável `5.0.6` (publicada 2026-02-23T13:59:08Z) e uma pré-release `6.0.0-beta` (publicada no mesmo dia, 2026-02-23T14:02:37Z, sem atualização posterior até a data de acesso). Nenhuma versão mais recente que fevereiro/2026 existe no registro — ou seja, o pacote está **sem release há ~7 meses** na data desta pesquisa (2026-09-27). https://registry.npmjs.org/expo-share-extension — 2026-09-27.
- **Tabela de compatibilidade declarada no README** (github.com/MaxAst/expo-share-extension, branch `main`, acessado 2026-09-27): SDK 54→5.0.0+, SDK 53→4.0.0+, SDK 52→2.0.0+/3.0.0+, SDK 51→1.5.3+, SDK 50→1.0.0+. **Não há linha para SDK 55, 56 ou 57** — ou seja, nem a versão estável nem a beta declaram suporte oficial ao SDK 57 usado neste projeto (57.0.25).
- **Issues abertas relevantes** (github.com/MaxAst/expo-share-extension/issues, 25 abertas no total, acessado 2026-09-27):
  - [#121](https://github.com/MaxAst/expo-share-extension/issues/121) "Share extension crashes on boot with Expo SDK 57: Cannot read property 'EventEmitter' of undefined" — aberta em 11/08/2026, **sem resolução até a data de acesso**. Evidência direta de incompatibilidade relatada por terceiros com o SDK 57 (a mesma versão do nosso spike).
  - [#117](https://github.com/MaxAst/expo-share-extension/issues/117) "ShareExtension crashes with RCTThirdPartyComponentsProvider on New Architecture" — aberta 15/04/2026, aberta ainda. Evidência de incompatibilidade relatada com a New Architecture.
  - [#100](https://github.com/MaxAst/expo-share-extension/issues/100) "Invariant Violation: 'shareExtension' has not been registered when using Expo Router" — aberta 14/12/2025, aberta ainda. Evidência de conflito com Expo Router.
  - [#120](https://github.com/MaxAst/expo-share-extension/issues/120) "Android Support + SDK 55" — aberta 06/08/2026, **é um pedido de feature, não uma funcionalidade existente** — confirma por si só que Android não é suportado hoje.
  - [#122](https://github.com/MaxAst/expo-share-extension/issues/122), [#97](https://github.com/MaxAst/expo-share-extension/issues/97), [#84](https://github.com/MaxAst/expo-share-extension/issues/84) — crashes diversos relatados (tela branca/congelada).
- **Tipos de conteúdo suportados** (README, via `activationRules` mapeado para `NSExtensionActivationRule` do iOS): `url` (max 1), `text`, `image` (max configurável, default docs citam até 2), `video`/`movie` (max 1 default), `file` genérico (max configurável, default até 3) — cobre URL/texto/imagem/múltiplas imagens/vídeo; PDF entraria na categoria genérica `file`, sem tratamento especial documentado.
- **App Groups**: exigido, igual ao `expo-share-intent` — "By default the App Group is set to the bundle identifier with the `group.` prefix" (README) — mesmo pré-requisito de Apple Developer Program pago.
- **Manutenção geral**: 554 estrelas, 33 forks, 310 commits no branch main, licença MIT, mantenedor único (MaxAst) — perfil de comunidade menor que `expo-share-intent` (606 estrelas) e com issues abertas mais graves (crash direto na versão de SDK usada neste projeto).

## Veredito de pesquisa (antes mesmo do prebuild)

**`expo-share-extension` é estritamente iOS.** Não existe suporte a Android nem como feature declarada, nem como issue resolvida — a única menção a Android no rastreador é um pedido de funcionalidade ainda aberto (#120). Isso confirma a hipótese da tarefa: se este plugin fosse adotado, o Android precisaria de uma solução separada — ex.: `expo-share-intent` usado **somente na parte Android** (mecanismo já confirmado por spike no SPIKE-12), ou um intent-filter `ACTION_SEND` configurado manualmente via config plugin próprio/`expo-build-properties` + edição do `AndroidManifest.xml` gerado, para não depender de dois plugins concorrentes tentando gerenciar o mesmo `AndroidManifest.xml`.

Além disso, diferente do `expo-share-intent` (compatibilidade oficial confirmada com SDK 57 no SPIKE-12), o `expo-share-extension` **não declara suporte ao SDK 57** e tem uma issue aberta e não resolvida relatando exatamente um crash no boot da extensão nessa versão do SDK. Isso foi tratado como sinal de risco alto antes mesmo de rodar o prebuild.

## Ambiente do spike

- SO: Windows 10 Pro 10.0.19045 (via Git Bash) — mesmo ambiente do SPIKE-12.
- `create-expo-app@latest` gerou `expo@~57.0.25`, `react-native@0.86.3`, `react@19.2.3` — **confirmado idêntico ao SPIKE-12** (`package.json` gerado).
- Plugin instalado: `expo-share-extension@6.0.0-beta` (escolhida em vez da estável `5.0.6` porque a tabela do README não declara suporte a SDK 57 em nenhuma das duas séries; a beta foi a opção mais recente disponível no npm).

## Comandos executados

```bash
npx --yes create-expo-app@latest expo-share-extension --template blank-typescript
npm install expo-share-extension@6.0.0-beta
# app.json editado manualmente para incluir "scheme", bundleIdentifier/package
# próprios do spike, e o plugin "expo-share-extension" com activationRules
# (url max 1, text, image max 2, video max 1, file max 3) e height 500
npx expo prebuild --platform android --no-install
npx expo prebuild --platform ios --no-install
```

## Resultados

### Android — NENHUMA ALTERAÇÃO DE SHARE GERADA (confirma plugin iOS-only)

`npx expo prebuild --platform android --no-install` rodou sem erros, mas o `AndroidManifest.xml` gerado **não contém nenhum intent-filter `ACTION_SEND`** nem qualquer vestígio do plugin `expo-share-extension`. O único intent-filter customizado presente é o do `scheme` genérico do app.json (`expo-share-ext-spike`), que não tem relação com compartilhamento recebido de outros apps:

```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW"/>
  <category android:name="android.intent.category.DEFAULT"/>
  <category android:name="android.intent.category.BROWSABLE"/>
  <data android:scheme="expo-share-ext-spike"/>
</intent-filter>
```

Não houve nenhuma linha de log do config plugin mencionando Android (diferente do SPIKE-12, que logou explicitamente `[expo-share-intent] add android filters...`).

**Conclusão:** confirmado por evidência direta de spike (não só pela documentação) que o `expo-share-extension` não faz nada no Android. Qualquer app que precise de share sheet em Android usando este plugin como base para iOS precisaria de um segundo mecanismo (ex.: `expo-share-intent` restrito à parte Android, ou intent-filter manual) — consistente com a pesquisa prévia.

### iOS — NÃO GERADO (mesma limitação de host já confirmada no SPIKE-12)

`npx expo prebuild --platform ios --no-install` retornou exatamente o mesmo comportamento do SPIKE-12:

```
⚠️  Skipping generating the iOS native project files. Run npx expo prebuild again from macOS or Linux to generate the iOS project.
CommandError: At least one platform must be enabled when syncing
```

Confirmado com `ls` que nenhum diretório `ios/` foi criado.

**Conclusão:** a limitação é do `expo prebuild` para iOS no Windows em geral (já registrada no SPIKE-12), não específica deste plugin. Isso significa que, assim como o `expo-share-intent`, **não foi possível verificar neste ambiente se o `expo-share-extension` gera corretamente o alvo da Share Extension no Xcode/App Groups** — precisa de macOS/Linux ou EAS Build (ver `docs/phase0/spikes/EAS-BUILD-ROTEIRO.md`).

## Comparação direta com o SPIKE-12 (`expo-share-intent`)

| Critério | `expo-share-intent` (SPIKE-12) | `expo-share-extension` (SPIKE-13) |
|---|---|---|
| Suporte Android | Confirmado por spike (intent-filter `ACTION_SEND` gerado) | Inexistente — confirmado por spike (nenhuma alteração no manifest) e por issue aberta (#120) |
| Declara suporte ao SDK 57 | Sim (release 8.0.0/8.0.1 explicitamente para SDK 57) | Não (tabela do README para em SDK 54; nenhuma versão publicada desde fev/2026) |
| Issue aberta específica de crash no SDK 57 | Não encontrada | Sim, #121, sem resolução |
| Issue aberta de conflito com New Architecture | Não documentado explicitamente (nem a favor nem contra) | Sim, issue #117 relatando crash, sem resolução |
| Issue aberta de conflito com Expo Router | Sim (#166/#171/#189), com workaround documentado | Sim (#100), sem workaround confirmado no README |
| Última release | 2026-07-10 (ativo) | 2026-02-23 (~7 meses sem release nesta pesquisa) |
| Estrelas/issues abertas | 606 estrelas / 39 issues abertas | 554 estrelas / 25 issues abertas |
| Prebuild iOS verificável no Windows | Não (limitação de host) | Não (mesma limitação de host) |
| Prebuild Android verificável no Windows | Sim, sucesso | N/A (plugin não atua em Android) |

## Artefatos

- Projeto completo (sem `node_modules`, apagado ao final conforme regra da tarefa) em `docs/phase0/spikes/expo-share-extension/`.
- `android/app/src/main/AndroidManifest.xml` gerado e preservado como evidência (mostra ausência de intent-filter de share).
- Nenhum diretório `ios/` existe (resultado do próprio spike, não uma omissão).
- `eas.json` com profile `spike-ios-sim` (`ios.simulator: true`) adicionado para uso do dono do produto — ver `docs/phase0/spikes/EAS-BUILD-ROTEIRO.md`.
