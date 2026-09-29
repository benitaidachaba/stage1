import { NextResponse } from "next/server";

/**
 * The assistant behind "I can't start".
 *
 * The request carries only the task text the person chose to send. The reply is
 * one small first step of about two minutes — never a plan, never a lecture.
 * The model is Google's Gemini Flash-Lite, whose free tier comfortably covers
 * a personal app's few requests a day. When no key is set the route says so and
 * the client falls back to a built-in template, so the button never dead-ends.
 */

const MODEL = "gemini-2.0-flash-lite";

const SYSTEM_PROMPT = [
  "You help someone who is stuck starting a task.",
  "Write ONE concrete first step that takes about two minutes.",
  "It must be a physical action, like 'open the document' or 'write one sentence'.",
  "Under 15 words. No preamble, no quotes, no list, no period at the end.",
  "Plain words, warm but not cute. Never mention that you are an AI.",
].join(" ");

export async function POST(request: Request) {
  let body: { task?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The request could not be read." }, { status: 400 });
  }

  const task = typeof body.task === "string" ? body.task.trim().slice(0, 500) : "";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  if (task.length === 0) {
    return NextResponse.json({ error: "There was no task text to work with." }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "No assistant key is configured.", fallback: true },
      { status: 503 },
    );
  }

  const userContent = note.length > 0 ? `Task: ${task}\nContext note: ${note}` : `Task: ${task}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: userContent }] }],
          generationConfig: {
            temperature: 0.9,
            maxOutputTokens: 60,
            // One word in, one short phrase out: there is nothing to think about.
            candidateCount: 1,
          },
          safetySettings: [],
        }),
        // A stuck person should not wait long; the fallback is instant.
        signal: AbortSignal.timeout(12_000),
      },
    );

    if (!response.ok) {
      const detail = response.status === 429 ? "the free quota for this minute is used up" : `the service answered ${response.status}`;
      return NextResponse.json({ error: `No suggestion right now: ${detail}.`, fallback: true }, { status: 502 });
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join(" ")
      .trim()
      .replace(/^["'“”]+|["'“”]+$/g, "")
      .replace(/\s+/g, " ");

    if (text.length === 0) {
      return NextResponse.json({ error: "The answer came back empty.", fallback: true }, { status: 502 });
    }

    return NextResponse.json({ suggestion: text.slice(0, 120) });
  } catch (error) {
    const detail =
      error instanceof Error && error.name === "TimeoutError"
        ? "the service took too long to answer"
        : "the service could not be reached";
    return NextResponse.json({ error: `No suggestion right now: ${detail}.`, fallback: true }, { status: 502 });
  }
}
