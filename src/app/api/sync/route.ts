import { getNeonAuth } from "@/lib/auth/server";
import { syncRecords } from "@/lib/neon-db";
import { syncRequestSchema } from "@/lib/sync-validation";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const protocol = request.headers.get("x-forwarded-proto") ?? url.protocol.slice(0, -1);
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== `${protocol}://${host}`)) {
    return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
  }
  const auth = getNeonAuth();
  if (!auth) return Response.json({ error: "Neon Auth is not configured." }, { status: 503, headers });
  try {
    const { data: session, error } = await auth.getSession();
    if (error) return Response.json({ error: "Could not verify your session. Please sign in again." }, { status: 401, headers });
    if (!session?.user) return Response.json({ error: "Sign in to sync your tasks." }, { status: 401, headers });
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 2_000_000) return Response.json({ error: "This sync is too large. Export a backup and reduce the data size." }, { status: 413, headers });
    let payload: unknown;
    try { payload = JSON.parse(text); } catch { return Response.json({ error: "Invalid sync request." }, { status: 400, headers }); }
    const parsed = syncRequestSchema.safeParse(payload);
    if (!parsed.success) return Response.json({ error: "Invalid sync records." }, { status: 400, headers });
    if (parsed.data.accountId !== session.user.id) return Response.json({ error: "Your account changed. Reload before syncing." }, { status: 409, headers });
    const records = await syncRecords(session.user.id, parsed.data.changes);
    return Response.json({ accountId: session.user.id, records }, { headers });
  } catch (error) {
    console.error("Neon sync failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Cloud sync could not connect. Your work is saved on this device; try again shortly." }, { status: 503, headers });
  }
}
