"use client";

/**
 * Voice input, in one hook.
 *
 * Two paths, tried in order:
 *  1. the browser's own speech recognition — instant, private, but only in
 *     some browsers (Chrome, Edge, Android);
 *  2. a MediaRecorder capture posted to /api/transcribe, where Gemini
 *     transcribes it server-side. The recording is never stored.
 *
 * Either way the result is plain text placed into a text field the person can
 * edit before saving. Voice never bypasses review.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> & { length: number } }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type RecognitionConstructor = new () => SpeechRecognitionLike;

function getRecognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type VoiceState = "idle" | "listening" | "recording" | "transcribing" | "error";

export interface VoiceInput {
  state: VoiceState;
  /** Partial text while the browser recognition is live. */
  interim: string;
  /** The last error, in words a person can act on. */
  error: string | null;
  /** True when this browser can do live recognition. */
  canRecognise: boolean;
  /** True when this browser can record for server transcription. */
  canRecord: boolean;
  /** True when at least one path exists. */
  available: boolean;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

export function useVoiceInput(onText: (text: string) => void): VoiceInput {
  const [state, setState] = useState<VoiceState>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [canRecognise, setCanRecognise] = useState(false);
  const [canRecord, setCanRecord] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);

  useEffect(() => {
    setCanRecognise(getRecognitionConstructor() !== null);
    if (typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined") {
      setCanRecord(true);
    }
  }, []);

  const finaliseRecording = useCallback(async () => {
    const blob = new Blob(chunksRef.current, { type: recorderRef.current?.mimeType || "audio/webm" });
    chunksRef.current = [];
    if (blob.size === 0) {
      setState("idle");
      setError("Nothing was recorded. Try holding the button a little longer.");
      return;
    }
    setState("transcribing");
    try {
      const form = new FormData();
      form.append("audio", blob, "note.webm");
      const response = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = (await response.json()) as { text?: string; error?: string };
      if (!response.ok || !data.text) {
        setError(data.error ?? "Transcription did not work. Typing works the same.");
        setState("error");
        return;
      }
      onTextRef.current(data.text);
      setState("idle");
    } catch {
      setError("The transcription service could not be reached. Typing works the same.");
      setState("error");
    }
  }, []);

  const start = useCallback(() => {
    setError(null);
    setInterim("");
    const Recognition = getRecognitionConstructor();
    if (Recognition) {
      const recognition = new Recognition();
      recognition.lang = typeof navigator !== "undefined" ? navigator.language : "en-GB";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        let finalText = "";
        let interimText = "";
        for (let index = 0; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result?.[0]?.transcript ?? "";
          if (index === event.results.length - 1 && result) {
            // The last result is the live one; earlier ones are already settled.
            const isFinal = Object.prototype.hasOwnProperty.call(result, "isFinal")
              ? (result as unknown as { isFinal: boolean }).isFinal
              : false;
            if (isFinal) finalText += transcript;
            else interimText += transcript;
          } else {
            finalText += transcript;
          }
        }
        setInterim(interimText);
        if (finalText.trim().length > 0) {
          onTextRef.current(finalText.trim());
          setInterim("");
        }
      };
      recognition.onerror = (event) => {
        if (event.error === "no-speech") {
          setError("Nothing was heard. Try again, a little closer to the microphone.");
        } else if (event.error === "not-allowed") {
          setError("The microphone was not allowed. Typing works the same.");
        } else {
          setError("Listening stopped unexpectedly. Typing works the same.");
        }
        setState("error");
      };
      recognition.onend = () => {
        setInterim("");
        setState((current) => (current === "listening" ? "idle" : current));
      };
      recognitionRef.current = recognition;
      try {
        recognition.start();
        setState("listening");
        return;
      } catch {
        // Fall through to recording.
      }
    }

    if (typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined") {
      void navigator.mediaDevices
        ?.getUserMedia({ audio: true })
        .then((stream) => {
          const recorder = new MediaRecorder(stream);
          chunksRef.current = [];
          recorder.ondataavailable = (event) => {
            if (event.data.size > 0) chunksRef.current.push(event.data);
          };
          recorder.onstop = () => {
            stream.getTracks().forEach((track) => track.stop());
            void finaliseRecording();
          };
          recorderRef.current = recorder;
          recorder.start();
          setState("recording");
        })
        .catch(() => {
          setError("The microphone was not allowed. Typing works the same.");
          setState("error");
        });
      return;
    }

    setError("Voice input is not available in this browser. Typing works the same.");
    setState("error");
  }, [finaliseRecording]);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Already stopped; nothing to do.
      }
      recognitionRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
      recorderRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setInterim("");
    setState("idle");
  }, []);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // Nothing to clean up.
        }
      }
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stream?.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return {
    state,
    interim,
    error,
    canRecognise,
    canRecord,
    available: canRecognise || canRecord,
    start,
    stop,
    reset,
  };
}
