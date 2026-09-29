// Exclusão definitiva da conta (LGPD art. 18, VI; App Store 5.1.1(v)).
import { DELETE_ACCOUNT_CONFIRMATION } from '@fruiqo/contracts';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput } from 'react-native';

import { ApiError } from '../src/api/client';
import { useAppState } from '../src/state/AppState';
import { Button } from '../src/ui/components';
import { ui } from '../src/ui/theme';
import { useTheme } from '../src/ui/ThemeProvider';

export default function DeleteAccount() {
  useTheme(); // re-renderiza na troca de tema
  const { deleteAccount } = useAppState();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = password.length > 0 && confirm === DELETE_ACCOUNT_CONFIRMATION && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(password); // no sucesso o app volta para o login
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 401) setError('Senha incorreta.');
      else if (err instanceof ApiError && err.status === 429) setError('Muitas tentativas. Espere um minuto.');
      else setError('Não foi possível excluir a conta agora. Tente de novo.');
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={ui.screen}>
      <ScrollView contentContainerStyle={[ui.pad, { gap: 14 }]} keyboardShouldPersistTaps="handled">
        <Text style={ui.h1}>Excluir minha conta</Text>
        <Text style={ui.body}>
          Isto apaga definitivamente a sua conta e tudo o que está nela: catálogo, listas, revisões, compartilhamentos,
          perfil de gosto, histórico e as sessões em todos os aparelhos. Não dá para desfazer.
        </Text>
        <TextInput
          style={ui.input}
          placeholder="Sua senha atual"
          accessibilityLabel="Sua senha atual"
          secureTextEntry
          autoFocus
          autoComplete="current-password"
          value={password}
          onChangeText={setPassword}
        />
        <Text style={ui.muted}>Digite {DELETE_ACCOUNT_CONFIRMATION} para confirmar</Text>
        <TextInput
          style={ui.input}
          placeholder={DELETE_ACCOUNT_CONFIRMATION}
          accessibilityLabel={`Digite ${DELETE_ACCOUNT_CONFIRMATION} para confirmar`}
          autoCapitalize="characters"
          autoCorrect={false}
          value={confirm}
          onChangeText={setConfirm}
          onSubmitEditing={() => void submit()}
        />
        {error ? (
          <Text style={ui.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button
          title={busy ? 'Excluindo…' : 'Excluir definitivamente'}
          icon="trash-outline"
          variant="danger"
          disabled={!ready}
          onPress={() => void submit()}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
