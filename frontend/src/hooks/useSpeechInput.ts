// Voice input with the browser's speech recognition (Chrome, Edge, Safari). `supported` is false
// elsewhere, so callers can hide the mic button.
import { useCallback, useEffect, useRef, useState } from 'react';

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};
type RecognitionCtor = new () => Recognition;

const Ctor: RecognitionCtor | undefined =
  typeof window === 'undefined'
    ? undefined
    : ((window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition);

export function useSpeechInput(onText: (text: string) => void, onError: (message: string) => void) {
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => () => rec.current?.stop(), []);

  const toggle = useCallback(() => {
    if (!Ctor) return;
    if (rec.current) {
      rec.current.stop();
      return;
    }
    const r = new Ctor();
    r.lang = navigator.language || 'en-IN';
    r.interimResults = false;
    r.continuous = false;
    r.onresult = (e) => {
      const text = Array.from(e.results)
        .filter((res) => res.isFinal)
        .map((res) => res[0].transcript)
        .join(' ')
        .trim();
      if (text) onText(text);
    };
    r.onerror = (e) => onError(e.error === 'not-allowed' ? 'Allow microphone access to speak a message.' : "Couldn't hear that. Try again.");
    r.onend = () => {
      rec.current = null;
      setListening(false);
    };
    rec.current = r;
    setListening(true);
    r.start();
  }, [onText, onError]);

  return { supported: Boolean(Ctor), listening, toggle };
}
