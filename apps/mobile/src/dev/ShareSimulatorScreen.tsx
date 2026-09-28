// Simulador de share (RF-18) — só existe fora de produção (metro.config.js exclui app/dev e src/dev do
// bundle de produção; scripts/check-prod-bundle.mjs confere). Emula o share sheet: URL, texto, imagens ou
// fixture sintética, e envia pelo MESMO ponto de entrada do share real (receiveShare → POST /shares).
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import { ApiError, createShare } from '../api/client';
import type { IncomingShare } from '../share/buildShareRequest';
import { pickerAssetsToFiles, type RecognizeFn } from '../share/ingestImages';
import { OcrProgressModal, useReceiveShare } from '../share/useImageIngestion';
import { Button, Chip } from '../ui/components';
import { colors, ui } from '../ui/theme';
import { SIM_FIXTURES, type SimFixture } from './fixtureIndex.generated';
import { fixtureRecognizer, fixtureToIncoming, imagesToIncoming, textToIncoming, urlToIncoming } from './simulator';

const KIND_LABEL: Record<SimFixture['kind'], string> = { text: 'texto', url: 'link', screenshot: 'prints' };

export function ShareSimulatorScreen() {
  const router = useRouter();
  const { receive, progress } = useReceiveShare();
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [fixture, setFixture] = useState<SimFixture | null>(null);
  const [markFixture, setMarkFixture] = useState(true);
  const [busy, setBusy] = useState(false);
  const isWeb = Platform.OS === 'web';

  async function send(incoming: IncomingShare, ocr?: { recognize: RecognizeFn; supported: boolean }, fixtureId?: string) {
    setBusy(true);
    try {
      const request = await receive(incoming, ocr);
      if (!request) return;
      const share = await createShare(request, { fixtureId: markFixture ? fixtureId : undefined });
      router.push({ pathname: '/share/[id]', params: { id: share.id } });
    } catch (e) {
      Alert.alert('Não foi possível enviar', e instanceof ApiError || e instanceof Error ? e.message : 'Erro desconhecido.');
    } finally {
      setBusy(false);
    }
  }

  async function sendImages() {
    // No navegador não há OCR: as imagens escolhidas usam o texto de OCR de uma fixture de prints (pela ordem).
    if (isWeb && fixture?.kind !== 'screenshot') {
      Alert.alert('Escolha uma fixture de prints', 'No navegador o OCR vem do texto da fixture. Selecione uma fixture de prints abaixo.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      orderedSelection: true,
      quality: 1,
    });
    if (res.canceled) return;
    const incoming = imagesToIncoming(pickerAssetsToFiles(res.assets));
    const ocr = isWeb && fixture ? { recognize: fixtureRecognizer(fixture), supported: true } : undefined;
    await send(incoming, ocr, isWeb && fixture ? fixture.id : undefined);
  }

  function sendFixture() {
    if (!fixture) return;
    const ocr = fixture.kind === 'screenshot' ? { recognize: fixtureRecognizer(fixture), supported: true } : undefined;
    void send(fixtureToIncoming(fixture), ocr, fixture.id);
  }

  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.pad} keyboardShouldPersistTaps="handled">
      <Text style={ui.muted}>
        Ferramenta de desenvolvimento: emula o share sheet e envia pelo mesmo caminho do share real. Não existe na
        versão de produção.
      </Text>

      <View style={ui.card}>
        <Text style={ui.h2}>Link</Text>
        <TextInput
          style={ui.input}
          value={url}
          onChangeText={setUrl}
          placeholder="https://www.instagram.com/reel/..."
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Button title="Compartilhar link" onPress={() => void send(urlToIncoming(url))} disabled={!url.trim() || busy} />
      </View>

      <View style={ui.card}>
        <Text style={ui.h2}>Texto</Text>
        <TextInput
          style={[ui.input, { minHeight: 90, textAlignVertical: 'top' }]}
          value={text}
          onChangeText={setText}
          placeholder={'1. Filme A (2020)\n2. Filme B (2021)'}
          multiline
        />
        <Button title="Compartilhar texto" onPress={() => void send(textToIncoming(text))} disabled={!text.trim() || busy} />
      </View>

      <View style={ui.card}>
        <Text style={ui.h2}>Imagens</Text>
        <Text style={ui.muted}>
          {isWeb
            ? 'No navegador não há OCR: escolha antes uma fixture de prints; o texto dela é usado para as imagens, na ordem.'
            : 'As imagens escolhidas passam pelo OCR do aparelho, como no share real.'}
        </Text>
        <Button title="Escolher imagens" variant="secondary" onPress={() => void sendImages()} disabled={busy} />
      </View>

      <View style={ui.card}>
        <Text style={ui.h2}>Fixture sintética</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {SIM_FIXTURES.map((f) => (
            <Chip
              key={f.id}
              label={f.id}
              hint={KIND_LABEL[f.kind]}
              selected={fixture?.id === f.id}
              onPress={() => setFixture(fixture?.id === f.id ? null : f)}
            />
          ))}
        </View>
        {fixture ? <Text style={ui.muted}>{fixture.description}</Text> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Switch value={markFixture} onValueChange={setMarkFixture} trackColor={{ true: colors.primary }} />
          <Text style={[ui.muted, { flex: 1 }]}>
            Marcar como fixture (cabeçalho X-Fruiqo-Fixture; a API só aceita com SANDBOX_ENABLED)
          </Text>
        </View>
        <Button title="Enviar fixture" onPress={sendFixture} disabled={!fixture || busy} loading={busy} />
      </View>

      <OcrProgressModal progress={progress} />
    </ScrollView>
  );
}
