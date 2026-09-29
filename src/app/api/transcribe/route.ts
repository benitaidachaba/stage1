import { NextResponse } from "next/server";

/**
 * The server-side transcription fallback.
 *
 * Used when the browser has no speech recognition (Firefox, most desktop Safari)
 * or the user prefers to record first. The audio goes straight to Gemini, which
 * transcribes it, and only the text comes back — the recording itself is never
 * stored. A missing key again degrades to an honest "not available" so the
 * client can say so instead of spinning.
 */

const MODEL = "gemini-2.0-flash-lite";

const MAX_BYTES = 10 * 1024 * 1024;

const TRANSCRIBE_PROMPT =
  "Transcribe this voice note exactly as spoken, in the language spoken. Return only the transcription, with no commentary.";

export async function POST(request: Request) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Transcription is not configured on this server.", fallback: true },
      { status: 503 },
    );
  }

  let audio: ArrayBuffer;
  let mime = "audio/webm";
  try {
    const form = await request.formData();
    const file = form.get("audio");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "No recording arrived." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "That recording is too long. Try a shorter note." }, { status: 413 });
    }
    if (typeof file.type === "string" && file.type.startsWith("audio/")) {
      mime = file.type;
    }
    audio = await file.arrayBuffer();
  } catch {
    return NextResponse.json({ error: "The recording could not be read." }, { status: 400 });
  }

  const toBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    return btoa(binary);
  };

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: TRANSCRIBE_PROMPT },
                { inlineData: { mimeType: mime, data: toBase64(audio) } },
              ],
            },
          ],
          generationConfig: { temperature: 0, maxOutputTokens: 1000 },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );

    if (!response.ok) {
      const detail = response.status === 429 ? "the free quota for this minute is used up" : `the service answered ${response.status}`;
      return NextResponse.json({ error: `Transcription did not work: ${detail}.` }, { status: 502 });
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join(" ")
      .trim();

    if (text.length === 0) {
      return NextResponse.json({ error: "Nothing could be heard in that recording." }, { status: 422 });
    }

    return NextResponse.json({ text: text.slice(0, 2000) });
  } catch (error) {
    const detail =
      error instanceof Error && error.name === "TimeoutError"
        ? "the service took too long to answer"
        : "the service could not be reached";
    return NextResponse.json({ error: `Transcription did not work: ${detail}.` }, { status: 502 });
  }
}
