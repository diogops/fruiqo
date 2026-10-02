import { EmailSchema, PasswordSchema } from '@fruiqo/contracts';
import * as Device from 'expo-device';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput } from 'react-native';

import { ApiError } from '../src/api/client';
import { useAppState } from '../src/state/AppState';
import { Button } from '../src/ui/components';
import { ui } from '../src/ui/theme';
import { useTheme } from '../src/ui/ThemeProvider';

function deviceName() {
  const name = Device.deviceName ?? Device.modelName ?? `${Platform.OS} device`;
  return name.slice(0, 64);
}

export default function Login() {
  useTheme(); // re-renderiza na troca de tema
  const { signIn, completeMfa, pendingShare } = useAppState();
  // MFA: depois da senha, o código do app autenticador
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    const e = EmailSchema.safeParse(email);
    if (!e.success) return setError('Informe um e-mail válido.');
    if (!PasswordSchema.safeParse(password).success) return setError('A senha precisa ter entre 12 e 128 caracteres.');
    setBusy(true);
    try {
      const challenge = await signIn(mode, e.data, password, deviceName());
      if (challenge) {
        setMfaToken(challenge.mfaToken);
        setCode('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    if (!mfaToken) return;
    setError(null);
    if (code.trim().length < 6) return setError('Digite o código de 6 dígitos.');
    setBusy(true);
    try {
      await completeMfa(mfaToken, code);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && /expirou/.test(err.message)) {
        setMfaToken(null);
        setError('O tempo para o código acabou. Entre de novo.');
      } else if (err instanceof ApiError && err.status === 401) setError('Código inválido. Confira o app autenticador e tente de novo.');
      else setError(err instanceof Error ? err.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  }

  if (mfaToken) {
    return (
      <KeyboardAvoidingView style={ui.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={ui.pad} keyboardShouldPersistTaps="handled">
          <Text style={ui.h1}>Verificação em duas etapas</Text>
          <Text style={ui.muted}>Digite o código de 6 dígitos do seu app autenticador, ou um código de recuperação.</Text>
          <TextInput
            style={ui.input}
            placeholder="Código"
            accessibilityLabel="Código"
            autoFocus
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={20}
            value={code}
            onChangeText={setCode}
            onSubmitEditing={submitCode}
          />
          {error && <Text style={ui.error}>{error}</Text>}
          <Button title="Entrar" onPress={submitCode} loading={busy} />
          <Button
            title="Voltar"
            variant="secondary"
            onPress={() => {
              setMfaToken(null);
              setCode('');
              setError(null);
            }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={ui.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={ui.pad} keyboardShouldPersistTaps="handled">
        <Text style={ui.h1}>{mode === 'login' ? 'Entrar' : 'Criar conta'}</Text>
        {pendingShare && <Text style={ui.muted}>Entre para concluir o envio do seu compartilhamento.</Text>}
        <TextInput
          style={ui.input}
          placeholder="E-mail"
          autoFocus
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={ui.input}
          placeholder="Senha (mínimo 12 caracteres)"
          secureTextEntry
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={submit}
        />
        {error && <Text style={ui.error}>{error}</Text>}
        <Button title={mode === 'login' ? 'Entrar' : 'Criar conta'} onPress={submit} loading={busy} />
        <Button
          title={mode === 'login' ? 'Ainda não tenho conta' : 'Já tenho conta'}
          variant="secondary"
          onPress={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
