// Recebe o conteúdo do share sheet, envia à API e abre o detalhe.
// Sem consentimento ou sem sessão, o share fica pendente (em memória) até o usuário concluir essas etapas.
// Prints de tela passam por OCR no device antes; só o texto extraído vira o share.
import { MAX_SCREENSHOT_PAGES } from '@fruiqo/contracts';
import { randomUUID } from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Text, View } from 'react-native';

import { ApiError, createShare } from '../api/client';
import { useAppState } from '../state/AppState';
import { colors, ui } from '../ui/theme';
import { buildShareRequest } from './buildShareRequest';
import { ocrSupported, recognizeAll, type OcrProgress } from './ocr';
import { buildPages, buildScreenshotRequest, selectImages } from './screenshotPages';

export function ShareIntentHandler() {
  const router = useRouter();
  const { hasShareIntent, shareIntent, resetShareIntent, error } = useShareIntentContext();
  const { ready, consented, authStatus, pendingShare, setPendingShare } = useAppState();
  const sending = useRef(false);
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null);

  // 1. Novo share chegou: converte (com OCR, se forem prints) e guarda como pendente.
  useEffect(() => {
    if (!hasShareIntent) return;
    const incoming = shareIntent;
    resetShareIntent();

    const images = selectImages(incoming.files);
    if (images) {
      void handleScreenshots(images.uris, images.truncated, images.ignoredOtherFiles);
      return;
    }

    const result = buildShareRequest(incoming, randomUUID());
    if (result.kind === 'unsupported') {
      Alert.alert(
        'Ainda não suportado',
        result.reason === 'files'
          ? 'PDF e outros arquivos ainda não são suportados nesta versão. Compartilhe prints (imagens) ou o link do post.'
          : 'Não encontramos texto, link ou imagem neste compartilhamento.',
      );
      return;
    }
    setPendingShare(result.request);
  }, [hasShareIntent, shareIntent, resetShareIntent, setPendingShare]);

  async function handleScreenshots(uris: string[], truncated: boolean, ignoredOtherFiles: boolean) {
    if (!ocrSupported) {
      Alert.alert(
        'Leitura de prints indisponível',
        'Este aparelho não suporta a leitura de texto em imagens. Compartilhe o link do post.',
      );
      return;
    }
    if (truncated) {
      Alert.alert('Muitos prints', `Serão lidos só os ${MAX_SCREENSHOT_PAGES} primeiros prints.`);
    }
    setOcrProgress({ current: 0, total: uris.length });
    try {
      const results = await recognizeAll(uris, setOcrProgress);
      const built = buildScreenshotRequest(buildPages(results), randomUUID());
      if (built.kind === 'empty') {
        Alert.alert('Nada para enviar', 'Não encontrei texto nos prints.');
        return;
      }
      if (ignoredOtherFiles) {
        Alert.alert('Arquivos ignorados', 'Só as imagens foram lidas; PDF e outros arquivos ainda não são suportados.');
      }
      // Pendente só em memória: o texto de terceiros não é gravado em disco.
      setPendingShare(built.request);
    } finally {
      setOcrProgress(null);
    }
  }

  useEffect(() => {
    if (error) Alert.alert('Erro ao receber compartilhamento', error);
  }, [error]);

  // 2. Com consentimento e sessão, envia o pendente.
  useEffect(() => {
    if (!pendingShare || !ready || !consented || authStatus !== 'signedIn' || sending.current) return;
    sending.current = true;
    createShare(pendingShare)
      .then((share) => {
        setPendingShare(null);
        router.push({ pathname: '/share/[id]', params: { id: share.id } });
      })
      .catch((e: unknown) => {
        // Erro de rede mantém o pendente (o clientShareId torna o reenvio idempotente).
        if (e instanceof ApiError && e.status !== 0) setPendingShare(null);
        Alert.alert('Não foi possível enviar', e instanceof Error ? e.message : 'Erro desconhecido.');
      })
      .finally(() => {
        sending.current = false;
      });
  }, [pendingShare, ready, consented, authStatus, setPendingShare, router]);

  return (
    <Modal visible={ocrProgress !== null} transparent animationType="fade" statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }}>
        <View style={[ui.card, { backgroundColor: colors.bg, alignItems: 'center', minWidth: 240, padding: 20 }]}>
          <ActivityIndicator color={colors.primary} />
          <Text style={ui.body}>
            {ocrProgress && ocrProgress.current > 0
              ? `Lendo print ${ocrProgress.current} de ${ocrProgress.total}…`
              : 'Preparando os prints…'}
          </Text>
          <Text style={ui.muted}>O texto é lido no seu aparelho.</Text>
        </View>
      </View>
    </Modal>
  );
}
