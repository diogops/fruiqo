// RF-40: importar prints de dentro do app (além do share sheet).
// Galeria e Arquivos usam os seletores do sistema (Photo Picker no Android, PHPicker no iOS),
// que entregam só o que o usuário escolhe: nenhuma permissão de galeria/armazenamento é pedida.
// Câmera pede permissão só no momento do uso. As imagens seguem o mesmo caminho do share
// (OCR no device → tela "Conferir títulos", app/import-review.tsx, onde só o confirmado é cadastrado). RF-47: arquivos .txt são lidos
// no aparelho e enviados em `textFile`; tudo cai na Revisão (RF-42). "Colar" lê a área de transferência:
// print copiado vai pelo mesmo OCR; texto copiado vira um .txt (src/share/clipboard.ts).
import { MAX_SCREENSHOT_PAGES } from '@fruiqo/contracts';
import { randomUUID } from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Modal, Pressable, Text, View } from 'react-native';

import { buildTextFileRequest, isImageFile, isTextFile } from '../catalog/logic';
import { useAppState } from '../state/AppState';
import { Button } from '../ui/components';
import { colors, ui } from '../ui/theme';
import { readClipboard } from './clipboard';
import { selectPickedImages, type PickerAsset } from './ingestImages';
import { draftFromOcr, setImportDraft } from './importDraft';
import { ocrSupported, recognizeAll, type OcrProgress } from './ocr';
import { OcrProgressModal } from './useImageIngestion';

const PDF_MESSAGE = 'PDF chega na próxima versão. Por enquanto, importe prints (imagens) ou uma lista em .txt.';

/** Lê o .txt escolhido (cópia no cache do app). Fallback via fetch caso o módulo de arquivos falhe. */
async function readText(uri: string): Promise<string> {
  try {
    return await new File(uri).text();
  } catch {
    const res = await fetch(uri);
    return await res.text();
  }
}

/** Pergunta se o usuário quer tirar outra foto. Resolve `true` para continuar. */
function askAnother(count: number): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      `${count} foto${count > 1 ? 's' : ''}`,
      count >= MAX_SCREENSHOT_PAGES ? `Limite de ${MAX_SCREENSHOT_PAGES} fotos atingido.` : 'Quer fotografar mais uma parte da lista?',
      count >= MAX_SCREENSHOT_PAGES
        ? [{ text: 'Concluir', onPress: () => resolve(false) }]
        : [
            { text: 'Concluir', onPress: () => resolve(false) },
            { text: 'Tirar outra', onPress: () => resolve(true) },
          ],
      { cancelable: false },
    );
  });
}

export function ImportPrints({ label = 'Importar', compact }: { label?: string; compact?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const { setPendingShare } = useAppState();
  const router = useRouter();

  /** Lê os prints no aparelho e abre "Conferir títulos": só o que o usuário confirmar é cadastrado. */
  async function finish(assets: PickerAsset[]) {
    const selection = selectPickedImages(assets);
    if (!selection) {
      Alert.alert('Nada para ler', 'Nenhuma imagem foi selecionada.');
      return;
    }
    if (!ocrSupported) {
      Alert.alert('Leitura de prints indisponível', 'Este aparelho não suporta a leitura de texto em imagens.');
      return;
    }
    if (selection.truncated) Alert.alert('Muitos prints', `Serão lidos só os ${MAX_SCREENSHOT_PAGES} primeiros prints.`);
    setProgress({ current: 0, total: selection.uris.length });
    try {
      const draft = draftFromOcr(await recognizeAll(selection.uris, setProgress));
      if (!draft) {
        Alert.alert('Nada para ler', 'Não encontrei texto nos prints. Tente prints mais nítidos, sem cortar os títulos.');
        return;
      }
      setImportDraft(draft);
      router.push('/import-review' as never);
    } finally {
      setProgress(null);
    }
  }

  async function fromGallery() {
    setOpen(false);
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_SCREENSHOT_PAGES,
      orderedSelection: true,
      quality: 1,
      exif: false,
      base64: false,
    });
    if (res.canceled) return;
    await finish(res.assets);
  }

  async function fromFiles() {
    setOpen(false);
    const res = await DocumentPicker.getDocumentAsync({
      type: ['image/*', 'text/plain', 'application/pdf'],
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (res.canceled) return;
    const texts = res.assets.filter(isTextFile);
    const images = res.assets.filter(isImageFile);
    if (texts.length > 0) {
      // RF-47: um .txt por vez (um título por linha; cabeçalhos como "Series:" definem o tipo)
      const file = texts[0]!;
      let content: string;
      try {
        content = await readText(file.uri);
      } catch {
        Alert.alert('Não foi possível ler o arquivo', 'Tente salvar o arquivo como texto (.txt, UTF-8) e importar de novo.');
        return;
      }
      const built = buildTextFileRequest(file.name ?? 'lista.txt', content, randomUUID);
      if (built.kind === 'empty') {
        Alert.alert('Arquivo vazio', 'Não encontrei títulos no arquivo.');
        return;
      }
      if (built.truncated) Alert.alert('Arquivo grande', 'Só o começo do arquivo foi enviado (limite de tamanho).');
      if (texts.length > 1 || images.length > 0) Alert.alert('Um arquivo por vez', `Importando só "${file.name ?? 'lista.txt'}".`);
      // Mesmo caminho do share: envio pelo ShareIntentHandler, resultado vai para a Revisão.
      setPendingShare(built.request);
      return;
    }
    if (images.length === 0) {
      Alert.alert('Ainda não suportado', PDF_MESSAGE);
      return;
    }
    if (images.length < res.assets.length) Alert.alert('PDF ignorado', PDF_MESSAGE);
    await finish(images);
  }

  /** Print copiado → OCR no aparelho; texto copiado (lista) → mesmo caminho do .txt. */
  async function fromClipboard() {
    setOpen(false);
    let content: Awaited<ReturnType<typeof readClipboard>>;
    try {
      content = await readClipboard();
    } catch {
      Alert.alert('Não foi possível colar', 'Não consegui ler a área de transferência. Tente copiar de novo.');
      return;
    }
    if (content.kind === 'image') {
      await finish([{ uri: content.uri, mimeType: 'image/png', type: 'image' }]);
      return;
    }
    if (content.kind === 'text') {
      const built = buildTextFileRequest('texto colado', content.text, randomUUID);
      if (built.kind === 'empty') {
        Alert.alert('Nada para importar', 'O texto copiado não tem títulos.');
        return;
      }
      if (built.truncated) Alert.alert('Texto grande', 'Só o começo do texto foi enviado (limite de tamanho).');
      setPendingShare(built.request);
      return;
    }
    Alert.alert('Área de transferência vazia', 'Copie um print ou uma lista de títulos e toque em Colar.');
  }

  async function fromCamera() {
    setOpen(false);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Câmera não autorizada',
        'Para fotografar listas, permita o acesso à câmera nas configurações do aparelho. Você também pode importar prints pela Galeria.',
      );
      return;
    }
    const shots: PickerAsset[] = [];
    while (shots.length < MAX_SCREENSHOT_PAGES) {
      const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false, base64: false });
      if (res.canceled) break;
      shots.push(...res.assets);
      if (!(await askAnother(shots.length))) break;
    }
    if (shots.length > 0) await finish(shots);
  }

  return (
    <>
      <Button title={label} icon="cloud-upload-outline" compact={compact} onPress={() => setOpen(true)} />
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={() => setOpen(false)} />
        <View style={[ui.pad, { backgroundColor: colors.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16 }]}>
          <Text style={ui.h2}>Importar títulos</Text>
          <Text style={ui.muted}>
            Prints (até {MAX_SCREENSHOT_PAGES}, na ordem escolhida) são lidos no seu aparelho; a imagem não sai do celular. Uma
            lista em .txt pode ter um título por linha, com cabeçalhos como "Series:" ou "Filmes:". Tudo passa pela Revisão
            antes de entrar no catálogo.
          </Text>
          <Button title="Galeria" icon="images" onPress={fromGallery} />
          <Button title="Colar (print ou lista copiada)" icon="clipboard-outline" variant="secondary" onPress={fromClipboard} />
          <Button title="Arquivos (.txt ou imagens)" icon="document-text-outline" variant="secondary" onPress={fromFiles} />
          <Button title="Câmera" icon="camera-outline" variant="secondary" onPress={fromCamera} />
          <Button title="Cancelar" variant="secondary" onPress={() => setOpen(false)} />
        </View>
      </Modal>
      <OcrProgressModal progress={progress} />
    </>
  );
}
