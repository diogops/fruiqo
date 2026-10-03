// Pedido por voz no "Como estou": grava e transcreve no campo; enquanto grava, o botão pisca em verde. Tocar nele
// para de gravar, espera o texto final e chama `onDone` (a tela já pede a sugestão). Para sozinho quando você para
// de falar ou em 30 s. O reconhecimento é do sistema (no aparelho quando ele suporta; senão, o serviço de voz do
// Google no Android ou da Apple no iOS); o áudio nunca vai para a API do Fruiqo.
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, Pressable, type ViewStyle } from 'react-native';

import { Icon } from '../ui/components';
import { colors } from '../ui/theme';

const MAX_MS = 30_000;
const STOP_GRACE_MS = 2_500;
const GREEN = '#4ade80';

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback; // sem o módulo nativo (build antigo, testes)
  }
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Permita o uso do microfone para falar o pedido.',
  'service-not-allowed': 'O reconhecimento de voz não está disponível neste aparelho.',
  'audio-capture': 'Não deu para usar o microfone.',
  network: 'Sem conexão para reconhecer a fala.',
};

type Session = { prefix: string; heard: string; failed: boolean; onDevice: boolean; done: boolean };

/** `base` é o que já está no campo; a fala entra depois dele. */
export function VoiceButton({
  base,
  onText,
  onDone,
  disabled,
}: {
  base: string;
  onText: (text: string) => void;
  onDone: (text: string) => void;
  disabled?: boolean;
}) {
  const [ok] = useState(() => safe(() => ExpoSpeechRecognitionModule.isRecognitionAvailable(), false));
  const [phase, setPhase] = useState<'idle' | 'listening' | 'stopping'>('idle');
  const session = useRef<Session | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const blink = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (phase !== 'listening') {
      blink.stopAnimation();
      blink.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0.45, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, blink]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      if (session.current) {
        session.current.done = true;
        safe(() => ExpoSpeechRecognitionModule.abort(), undefined);
      }
    },
    [],
  );

  function finish() {
    const s = session.current;
    if (!s || s.done) return;
    s.done = true;
    session.current = null;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase('idle');
    const text = s.heard.trim();
    if (!s.failed && text && text !== s.prefix.trim()) onDone(text);
  }

  useSpeechRecognitionEvent('result', (e) => {
    const s = session.current;
    if (!s || s.done) return;
    s.heard = (s.prefix + (e.results[0]?.transcript ?? '')).replace(/\s+/g, ' ').trimStart();
    onText(s.heard);
  });
  useSpeechRecognitionEvent('error', (e) => {
    const s = session.current;
    if (!s || s.done) return;
    // sem o idioma baixado para reconhecer no aparelho: recomeça pelo serviço de voz do sistema
    if (s.onDevice && e.error === 'language-not-supported') {
      s.done = true;
      session.current = null;
      setTimeout(() => begin(s.prefix, false), 0);
      return;
    }
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    s.failed = true;
    Alert.alert('Falar o pedido', ERRORS[e.error] ?? 'Não deu para reconhecer a fala.');
  });
  useSpeechRecognitionEvent('end', () => finish());

  function begin(prefix: string, onDevice: boolean) {
    session.current = { prefix, heard: '', failed: false, onDevice, done: false };
    timers.current.push(setTimeout(stop, MAX_MS));
    try {
      ExpoSpeechRecognitionModule.start({ lang: 'pt-BR', interimResults: true, continuous: false, requiresOnDeviceRecognition: onDevice });
      setPhase('listening');
    } catch {
      session.current = null;
      setPhase('idle');
      Alert.alert('Falar o pedido', 'Não deu para ligar o microfone.');
    }
  }

  /** para de gravar e espera o texto final; se o fim não vier em 2,5 s, usa o que já foi ouvido */
  function stop() {
    if (!session.current) return;
    setPhase('stopping');
    safe(() => ExpoSpeechRecognitionModule.stop(), undefined);
    timers.current.push(
      setTimeout(() => {
        finish();
        safe(() => ExpoSpeechRecognitionModule.abort(), undefined);
      }, STOP_GRACE_MS),
    );
  }

  async function press() {
    if (phase === 'listening') return stop();
    if (phase === 'stopping') return;
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Falar o pedido', ERRORS['not-allowed']!);
      return;
    }
    begin(base.trim() ? `${base.trim()} ` : '', safe(() => ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(), false));
  }

  if (!ok) return null;
  const listening = phase === 'listening';
  const stopping = phase === 'stopping';
  const label = stopping ? 'Transcrevendo' : listening ? 'Gravando: toque para parar e pedir' : 'Falar o pedido';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: listening, busy: stopping, disabled: stopping || (disabled && !listening) }}
      onPress={() => void press()}
      disabled={stopping || (disabled && phase === 'idle')}
      hitSlop={4}
    >
      <Animated.View
        style={[
          {
            width: 52,
            height: 52,
            borderRadius: 26,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: listening || stopping ? GREEN : colors.borderStrong,
            backgroundColor: listening ? GREEN : stopping ? '#bbf7d0' : colors.surface2,
            opacity: disabled && phase === 'idle' ? 0.5 : blink,
          } as Animated.WithAnimatedObject<ViewStyle>,
        ]}
      >
        <Icon name="mic" size={22} color={listening || stopping ? '#052e16' : colors.text2} />
      </Animated.View>
    </Pressable>
  );
}
