// Recebe o conteúdo do share sheet, envia à API e abre o detalhe.
// Sem consentimento ou sem sessão, o share fica pendente (em memória) até o usuário concluir essas etapas.
// Prints de tela passam por OCR no device antes (receiveShare → ingestImages, o mesmo do "Importar prints");
// só o texto extraído vira o share.
import { useRouter } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import { ApiError, createShare } from '../api/client';
import { useAppState } from '../state/AppState';
import { OcrProgressModal, useReceiveShare } from './useImageIngestion';

export function ShareIntentHandler() {
  const router = useRouter();
  const { hasShareIntent, shareIntent, resetShareIntent, error } = useShareIntentContext();
  const { ready, consented, authStatus, pendingShare, setPendingShare } = useAppState();
  const sending = useRef(false);
  const { receive, progress } = useReceiveShare();

  // 1. Novo share chegou: converte (com OCR, se forem prints) e guarda como pendente.
  useEffect(() => {
    if (!hasShareIntent) return;
    const incoming = shareIntent;
    resetShareIntent();

    // Mesmo ponto de entrada do simulador de dev (receiveShare); pendente só em memória.
    void receive(incoming).then((request) => {
      if (request) setPendingShare(request);
    });
  }, [hasShareIntent, shareIntent, resetShareIntent, setPendingShare, receive]);

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
