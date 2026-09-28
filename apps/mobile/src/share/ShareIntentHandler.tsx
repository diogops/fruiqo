// Recebe o conteúdo do share sheet, envia à API e abre o detalhe.
// Sem consentimento ou sem sessão, o share fica pendente (em memória) até o usuário concluir essas etapas.
// Prints de tela passam por OCR no device antes (useImageIngestion, o mesmo do "Importar prints");
// só o texto extraído vira o share.
import { randomUUID } from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import { ApiError, createShare } from '../api/client';
import { useAppState } from '../state/AppState';
import { buildShareRequest } from './buildShareRequest';
import { selectImages } from './screenshotPages';
import { OcrProgressModal, useImageIngestion } from './useImageIngestion';

export function ShareIntentHandler() {
  const router = useRouter();
  const { hasShareIntent, shareIntent, resetShareIntent, error } = useShareIntentContext();
  const { ready, consented, authStatus, pendingShare, setPendingShare } = useAppState();
  const sending = useRef(false);
  const { ingest, progress } = useImageIngestion();

  // 1. Novo share chegou: converte (com OCR, se forem prints) e guarda como pendente.
  useEffect(() => {
    if (!hasShareIntent) return;
    const incoming = shareIntent;
    resetShareIntent();

    const images = selectImages(incoming.files);
    if (images) {
      void ingest(images);
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
  }, [hasShareIntent, shareIntent, resetShareIntent, setPendingShare, ingest]);

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

  return <OcrProgressModal progress={progress} />;
}
