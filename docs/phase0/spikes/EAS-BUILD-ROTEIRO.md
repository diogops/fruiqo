# Roteiro de EAS Build (iOS Simulator) para os dois spikes de share

Público: dono do produto, que vai rodar o EAS Build pessoalmente para validar a geração da Share Extension iOS nos dois projetos de spike (`expo-share` = SPIKE-12 = `expo-share-intent`; `expo-share-extension` = SPIKE-13 = `expo-share-extension` de MaxAst). Nenhum comando `eas` foi executado pelo agente — só a preparação (`eas.json`) foi feita.

Por que "iOS Simulator" e não device real: um build `ios.simulator: true` no EAS Build **não exige conta Apple Developer paga nem certificados/provisioning profiles** (fonte: docs.expo.dev/build-reference/simulators/ — "a standalone version of the app running without needing to deploy to TestFlight or even having an Apple Developer account", acessado 2026-09-27). Isso é suficiente para confirmar que o `expo prebuild` remoto (rodado pelo EAS em macOS) gera corretamente o alvo da Share Extension e a configuração de App Groups no projeto Xcode, sem precisar da assinatura de US$99/ano do Apple Developer Program (P-APPLE-DEV) nesta etapa. Um build para device real ou TestFlight, esse sim, exige a conta paga — ver observação final.

## 0. Pré-requisitos

1. Conta Expo (gratuita) — criar em https://expo.dev/signup se ainda não tiver.
2. Node.js instalado (qualquer versão recente; os projetos de spike foram gerados com Node 20, mas o `create-expo@5.0.2` avisou que prefere `^22.13.0 || ^24.3.0 || ^26.0.0 || >=27.0.0` — use a versão mais nova disponível se possível).
3. Instalar a EAS CLI globalmente:
   ```bash
   npm install -g eas-cli
   ```
4. Login:
   ```bash
   eas login
   ```
   (usa a conta Expo gratuita do passo 1 — **não** é a conta Apple Developer.)
5. Não é necessário Xcode nem macOS na sua máquina para o build em si (o build roda nos servidores do EAS). Só é necessário um Mac se você quiser efetivamente **rodar** o app resultante no Simulador do iOS (o Simulador do iOS só existe no macOS).

## 1. Projeto SPIKE-12 (`expo-share-intent`)

```bash
cd docs/phase0/spikes/expo-share
npm install
eas build --profile spike-ios-sim --platform ios
```

O que vai acontecer:
- Como não existe pasta `ios/` neste projeto (ela é ignorada no `.gitignore` e o `prebuild` local só gerou `android/`), o EAS Build vai rodar `expo prebuild` remotamente em macOS para gerar o projeto iOS do zero — **é exatamente isso que queremos validar**, já que o SPIKE-12 confirmou que isso falha no Windows.
- Na primeira execução, a CLI vai perguntar se quer que ela gerencie as credenciais iOS. Para um build de simulador, normalmente nem chega a pedir certificado/assinatura — se perguntar, escolha a opção de deixar o EAS gerenciar (não precisa ter conta Apple Developer paga só para isso).
- O build fica na fila e roda na nuvem; acompanhe o link impresso no terminal (também disponível em https://expo.dev, na aba "Builds" do projeto).

## 2. Projeto SPIKE-13 (`expo-share-extension`)

```bash
cd docs/phase0/spikes/expo-share-extension
npm install
eas build --profile spike-ios-sim --platform ios
```

Mesmo fluxo do passo 1. **Atenção**: a pesquisa desta rodada (ver `SPIKE-NOTES.md` deste diretório) encontrou uma issue aberta e não resolvida no repositório do plugin (`MaxAst/expo-share-extension#121`) relatando crash no boot da extensão especificamente com Expo SDK 57 — a mesma versão usada neste projeto. É esperado que esse build **possa falhar ou gerar um app que crasha ao abrir a extensão**; isso também é informação útil (confirmaria a issue) e deve ser registrado normalmente, não é um erro de configuração seu.

## 3. O que conferir no build/log (para os dois projetos)

Independente de ter ou não um Mac para rodar o resultado, o **log do build em si** (disponível no link do terminal ou em expo.dev → Builds → clique no build → "View logs") já comprova várias coisas, mesmo sem instalar nada:

1. **Fase "Prebuild" / "Run expo prebuild"**: confirme que ela roda sem erro e que o log menciona a criação da pasta `ios/`. Se houver erro aqui, é evidência de que o plugin não é compatível com prebuild automatizado nesta configuração.
2. **Fase "Install pods" / "Pod install"**: confirme que ela termina com sucesso. Se o Podfile gerado pelo plugin tiver algum problema, costuma falhar aqui.
3. **Fase "Run fastlane" / "Build app"** (compilação Xcode propriamente dita, via `xcodebuild`): confirme que termina com "Build Succeeded" ou equivalente, sem erros de compilação. Um crash em runtime (como a issue #121 relatada) **não aparece aqui** — só apareceria ao rodar o app.
4. **Target da Share Extension**: no log da fase de build (ou baixando o artefato `.tar.gz`/`.app` gerado e inspecionando com `unzip`/`tar` mesmo sem Mac), procure por um segundo alvo/target junto ao app principal — geralmente aparece no log do xcodebuild como `Building target "<NomeDoApp>ShareExtension"` (ou nome parecido definido pelo plugin) além do target principal. A presença desse segundo target na compilação é a confirmação de que a Share Extension foi gerada.
5. **App Group**: procure no log (ou no artefato baixado, dentro de `*.entitlements`) pela entrada `com.apple.security.application-groups` com um valor como `group.com.fruiqo.spike.exposhare` (SPIKE-12) ou `group.com.fruiqo.spike.exposhareext` (SPIKE-13). É possível inspecionar isso sem Mac: baixe o artefato do build (é um `.tar.gz` contendo o `.app` do simulador), descompacte com `tar -xzf` em qualquer SO, e abra o arquivo `*.entitlements` ou `Info.plist` dentro do bundle com um editor de texto.
6. **Se você tiver acesso a um Mac com Xcode/Simulador instalado**: rode `eas build:run -p ios --latest` (precisa do Xcode/Simulador do iOS instalado no Mac) para instalar o build direto no Simulador. Depois:
   - Abra o Safari (ou Fotos/Notas) no Simulador, tente compartilhar uma URL/texto/imagem e confirme se o app de spike aparece na folha de compartilhamento do Simulador.
   - Toque no app de spike na folha de compartilhamento e observe se abre a extensão (SPIKE-13, que renderiza UI própria) ou se some silenciosamente/crasha (o que confirmaria a issue #121 para SPIKE-13).
   - Registre isso em `docs/phase0/device-tests-log.md`.
7. **Se você NÃO tiver acesso a um Mac**: os itens 1–5 acima (log de build + inspeção do `.entitlements`/target sem precisar rodar o app) já são evidência suficiente para decidir se a Share Extension é gerada corretamente pelo plugin — mesmo sem confirmar o comportamento em runtime. Registre o resultado (sucesso/falha em cada fase, presença ou não do target/App Group) como atualização da pendência 11 do `integration-feasibility.md`.

## 4. Observação importante — device real / TestFlight exige conta paga

Este roteiro cobre **apenas** o build de iOS Simulator, que não exige a assinatura Apple Developer Program. Se depois de validar isso você quiser testar em um iPhone físico ou distribuir via TestFlight (interno ou externo), aí sim entra o pré-requisito de P-APPLE-DEV: conta Apple Developer Program paga (~US$99/ano), certificados de distribuição/desenvolvimento e provisioning profiles gerenciados pelo EAS ou manualmente. Isso está fora do escopo deste spike e não deve ser feito nesta rodada — é uma decisão de custo já registrada em D-03/`integration-feasibility.md` (seção 2, linha P-APPLE-DEV) e cabe ao dono do produto decidir quando avançar para essa etapa.

## 5. Nada disto commita ou publica nada

`eas build` só envia o código-fonte do projeto de spike para compilação nos servidores da Expo; não publica em nenhuma loja, não faz submit (`eas submit`), não usa EAS Update. Nenhuma credencial Apple é necessária para os comandos acima.

## 6. Android: APK do inspetor de share (SPIKE-15, teste §4.1)

O `App.tsx` do projeto `expo-share` virou um inspetor: mostra o payload bruto de cada compartilhamento recebido (tipo, texto, URL, arquivos, preview de imagem) e tem um botão "Exportar log", que manda o JSON pelo share sheet (WhatsApp, e-mail etc.).

```bash
cd docs/phase0/spikes/expo-share
eas build --profile spike-android-apk --platform android
```

- Não exige conta Google Play nem credenciais pagas. Na primeira vez, deixe o EAS gerar a keystore de Android.
- Ao terminar, abra o link/QR code **no Android**, baixe o `.apk` e instale. O Android vai pedir permissão para "instalar apps de fontes desconhecidas" para o navegador.
- Como o projeto já tem a pasta `android/` (gerada no SPIKE-12 com a configuração atual), o EAS usa essa pasta em vez de rodar o prebuild. Se mudar o `app.json`, rode `npx expo prebuild --platform android --clean` antes.

Teste (registre em `docs/phase0/device-tests-log.md`). No Instagram, YouTube e TikTok, toque em Compartilhar → "expo-share" para cada caso abaixo:

| App | Casos |
|---|---|
| Instagram | post de foto, carrossel, Reel, story (se o botão existir), perfil |
| YouTube | vídeo, Short, playlist |
| TikTok | vídeo, perfil |

Se "expo-share" não aparecer direto, procure em "Mais"/"Outros apps". Anote se o app de origem só oferece "Copiar link". No fim, use "Exportar log" e mande o JSON: ele é a evidência do §4.1 para Android.
