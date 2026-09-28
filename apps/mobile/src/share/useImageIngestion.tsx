// Hook único de ingestão de prints, usado pelo ShareIntentHandler e pelo ImportPrints (RF-40).
// Roda o OCR no device, avisa sobre limites e deixa o CreateShareRequest pendente em memória;
// o envio à API é feito pelo ShareIntentHandler (mesmo fluxo de consentimento/login do share).
import { type CreateShareRequest, MAX_SCREENSHOT_PAGES } from '@fruiqo/contracts';
import { randomUUID } from 'expo-crypto';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Text, View } from 'react-native';

import { useAppState } from '../state/AppState';
import { colors, ui } from '../ui/theme';
import type { IncomingShare } from './buildShareRequest';
import { ingestImages, type RecognizeFn } from './ingestImages';
import { ocrSupported, recognizeAll, type OcrProgress } from './ocr';
import { receiveShare, type ReceiveResult } from './receiveShare';
import { selectImages, type ImageSelection } from './screenshotPages';

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

/** Mostra o aviso adequado ao resultado e devolve o request, ou null quando não há o que enviar. */
export function handleReceiveResult(result: ReceiveResult): CreateShareRequest | null {
  switch (result.kind) {
    case 'ok':
      if (result.truncated) Alert.alert('Muitos prints', `Serão lidos só os ${MAX_SCREENSHOT_PAGES} primeiros prints.`);
      if (result.ignoredOtherFiles) {
        Alert.alert('Arquivos ignorados', 'Só as imagens foram lidas; PDF e outros arquivos ainda não são suportados.');
      }
      return result.request;
    case 'ocr_unavailable':
      Alert.alert(
        'Leitura de prints indisponível',
        'Este aparelho não suporta a leitura de texto em imagens. Compartilhe o link do post.',
      );
      return null;
    case 'no_text':
      Alert.alert('Nada para enviar', 'Não encontrei texto nos prints.');
      return null;
    case 'unsupported':
      Alert.alert(
        'Ainda não suportado',
        result.reason === 'files'
          ? 'PDF e outros arquivos ainda não são suportados nesta versão. Compartilhe prints (imagens) ou o link do post.'
          : 'Não encontramos texto, link ou imagem neste compartilhamento.',
      );
      return null;
  }
}

/**
 * Recebe um conteúdo compartilhado pelo ponto de entrada único (receiveShare), com o modal de progresso do OCR.
 * Usado pelo share sheet real e pelo simulador (/dev/share); o simulador injeta o OCR das fixtures.
 */
export function useReceiveShare() {
  const [progress, setProgress] = useState<OcrProgress | null>(null);

  const receive = useCallback(
    async (
      incoming: IncomingShare,
      ocr?: { recognize: RecognizeFn; supported: boolean },
    ): Promise<CreateShareRequest | null> => {
      const images = selectImages(incoming.files);
      if (images) setProgress({ current: 0, total: images.uris.length });
      try {
        const result = await receiveShare(incoming, {
          recognize: ocr?.recognize ?? recognizeAll,
          ocrSupported: ocr?.supported ?? ocrSupported,
          newId: randomUUID,
          onProgress: setProgress,
        });
        return handleReceiveResult(result);
      } finally {
        setProgress(null);
      }
    },
    [],
  );

  return { receive, progress };
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
