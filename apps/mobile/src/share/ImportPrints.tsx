// RF-40: importar prints de dentro do app (além do share sheet).
// Galeria e Arquivos usam os seletores do sistema (Photo Picker no Android, PHPicker no iOS),
// que entregam só o que o usuário escolhe: nenhuma permissão de galeria/armazenamento é pedida.
// Câmera pede permissão só no momento do uso. As imagens seguem o mesmo caminho do share
// (useImageIngestion → OCR no device → CreateShareRequest.pages).
import { MAX_SCREENSHOT_PAGES } from '@fruiqo/contracts';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert, Modal, Pressable, Text, View } from 'react-native';

import { Button } from '../ui/components';
import { colors, ui } from '../ui/theme';
import { selectPickedImages, type PickerAsset } from './ingestImages';
import { OcrProgressModal, useImageIngestion } from './useImageIngestion';

const PDF_MESSAGE = 'PDF chega na próxima versão. Por enquanto, importe prints (imagens).';

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

export function ImportPrints() {
  const [open, setOpen] = useState(false);
  const { ingest, progress } = useImageIngestion();

  async function finish(assets: PickerAsset[]) {
    const selection = selectPickedImages(assets);
    if (!selection) {
      Alert.alert('Nada para ler', 'Nenhuma imagem foi selecionada.');
      return;
    }
    await ingest(selection);
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
      type: ['image/*', 'application/pdf'],
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (res.canceled) return;
    const images = res.assets.filter((a) => a.mimeType?.toLowerCase().startsWith('image/'));
    if (images.length === 0) {
      Alert.alert('Ainda não suportado', PDF_MESSAGE);
      return;
    }
    if (images.length < res.assets.length) Alert.alert('PDF ignorado', PDF_MESSAGE);
    await finish(images);
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
      <Button title="Importar prints" onPress={() => setOpen(true)} />
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={() => setOpen(false)} />
        <View style={[ui.pad, { backgroundColor: colors.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16 }]}>
          <Text style={ui.h2}>Importar prints</Text>
          <Text style={ui.muted}>
            Até {MAX_SCREENSHOT_PAGES} imagens, na ordem escolhida. O texto é lido no seu aparelho; a imagem não sai do
            celular.
          </Text>
          <Button title="Galeria" onPress={fromGallery} />
          <Button title="Arquivos" variant="secondary" onPress={fromFiles} />
          <Button title="Câmera" variant="secondary" onPress={fromCamera} />
          <Button title="Cancelar" variant="secondary" onPress={() => setOpen(false)} />
        </View>
      </Modal>
      <OcrProgressModal progress={progress} />
    </>
  );
}
