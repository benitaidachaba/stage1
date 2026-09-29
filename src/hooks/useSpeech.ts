"use client";

/**
 * Text-to-speech, in one hook.
 *
 * Every task and note can be read aloud through the browser's speech synthesis,
 * at the speed the reader chose. Nothing is sent anywhere — this is the one
 * voice feature that needs no permission and no network.
 */

import { useCallback, useEffect, useRef } from "react";

export function useSpeech(rate: number) {
  const rateRef = useRef(rate);
  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);

  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

  const speak = useCallback(
    (text: string) => {
      if (!supported || text.trim().length === 0) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = Math.min(Math.max(rateRef.current, 0.5), 2);
      window.speechSynthesis.speak(utterance);
    },
    [supported],
  );

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
  }, [supported]);

  return { supported, speak, stop };
}
