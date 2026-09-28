// Hook único de ingestão de prints, usado pelo ShareIntentHandler e pelo ImportPrints (RF-40).
// Roda o OCR no device, avisa sobre limites e deixa o CreateShareRequest pendente em memória;
// o envio à API é feito pelo ShareIntentHandler (mesmo fluxo de consentimento/login do share).
import { MAX_SCREENSHOT_PAGES } from '@fruiqo/contracts';
import { randomUUID } from 'expo-crypto';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Text, View } from 'react-native';

import { useAppState } from '../state/AppState';
import { colors, ui } from '../ui/theme';
import { ingestImages } from './ingestImages';
import { ocrSupported, recognizeAll, type OcrProgress } from './ocr';
import type { ImageSelection } from './screenshotPages';

export function useImageIngestion() {
  const { setPendingShare } = useAppState();
  const [progress, setProgress] = useState<OcrProgress | null>(null);

  const ingest = useCallback(
    async (selection: ImageSelection) => {
      if (!ocrSupported) {
        Alert.alert(
          'Leitura de prints indisponível',
          'Este aparelho não suporta a leitura de texto em imagens. Compartilhe o link do post.',
        );
        return;
      }
      if (selection.truncated) {
        Alert.alert('Muitos prints', `Serão lidos só os ${MAX_SCREENSHOT_PAGES} primeiros prints.`);
      }
      setProgress({ current: 0, total: selection.uris.length });
      try {
        const built = await ingestImages(selection, {
          recognize: recognizeAll,
          newId: randomUUID,
          onProgress: setProgress,
        });
        if (built.kind === 'empty') {
          Alert.alert('Nada para enviar', 'Não encontrei texto nos prints.');
          return;
        }
        if (selection.ignoredOtherFiles) {
          Alert.alert('Arquivos ignorados', 'Só as imagens foram lidas; PDF e outros arquivos ainda não são suportados.');
        }
        // Pendente só em memória: o texto de terceiros não é gravado em disco.
        setPendingShare(built.request);
      } finally {
        setProgress(null);
      }
    },
    [setPendingShare],
  );

  return { ingest, progress };
}

export function OcrProgressModal({ progress }: { progress: OcrProgress | null }) {
  return (
    <Modal visible={progress !== null} transparent animationType="fade" statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }}>
        <View style={[ui.card, { backgroundColor: colors.bg, alignItems: 'center', minWidth: 240, padding: 20 }]}>
          <ActivityIndicator color={colors.primary} />
          <Text style={ui.body}>
            {progress && progress.current > 0
              ? `Lendo print ${progress.current} de ${progress.total}…`
              : 'Preparando os prints…'}
          </Text>
          <Text style={ui.muted}>O texto é lido no seu aparelho.</Text>
        </View>
      </View>
    </Modal>
  );
}
