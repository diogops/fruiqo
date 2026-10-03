// Pedido por voz (Web Speech API do navegador): grava, transcreve no campo e, quando você para de falar,
// avisa (`onDone`) para a tela já pesquisar. Nada de áudio passa pelo Fruiqo.
// O reconhecimento é do próprio navegador (no Chrome, pelo serviço do Google; no Safari, pela Apple).
// Sem suporte (Firefox, por exemplo), o botão não aparece.
import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui';

interface RecognitionResult {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}
interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Permita o uso do microfone para falar o pedido.',
  'service-not-allowed': 'Permita o uso do microfone para falar o pedido.',
  'audio-capture': 'Nenhum microfone encontrado.',
  network: 'Sem conexão para reconhecer a fala.',
};

/**
 * Botão de microfone: enquanto grava, `onText` recebe o texto já reconhecido somado ao que estava no campo
 * (`base`), parcial e depois final. Para sozinho quando você para de falar (ou ao tocar de novo) e, se algo foi
 * reconhecido, chama `onDone` com o texto final.
 */
export function VoiceButton({
  base,
  onText,
  onDone,
  onError,
  disabled,
}: {
  base: string;
  onText: (text: string) => void;
  onDone?: (text: string) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
}) {
  const [Ctor] = useState(recognitionCtor);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => () => rec.current?.abort(), []);

  if (!Ctor) return null;

  function start() {
    const r = new Ctor!();
    r.lang = 'pt-BR';
    r.interimResults = true;
    r.continuous = false;
    const prefix = base.trim() ? `${base.trim()} ` : '';
    let finalText = '';
    let heard = '';
    let failed = false;
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      heard = (prefix + finalText + interim).replace(/\s+/g, ' ').trimStart();
      onText(heard);
    };
    r.onerror = (e) => {
      failed = e.error !== 'no-speech';
      if (e.error !== 'aborted' && e.error !== 'no-speech') onError?.(ERRORS[e.error] ?? 'Não deu para reconhecer a fala.');
    };
    r.onend = () => {
      setListening(false);
      rec.current = null;
      if (!failed && heard.trim() && heard.trim() !== base.trim()) onDone?.(heard.trim());
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      rec.current = null;
      onError?.('Não deu para ligar o microfone.');
    }
  }

  function toggle() {
    if (rec.current) rec.current.stop();
    else start();
  }

  const label = listening ? 'Parar de gravar' : 'Falar o pedido';
  return (
    <button
      type="button"
      className={listening ? 'voice-btn on' : 'voice-btn'}
      aria-label={label}
      title={label}
      aria-pressed={listening}
      disabled={disabled && !listening}
      onClick={toggle}
    >
      <Icon name="mic" size={18} />
    </button>
  );
}
