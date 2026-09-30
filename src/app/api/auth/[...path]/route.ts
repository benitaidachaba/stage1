import { getNeonAuth } from "@/lib/auth/server";
import type { NextRequest } from "next/server";

async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const auth = getNeonAuth();
  if (!auth) return Response.json({ error: "Neon Auth is not configured." }, { status: 503 });
  const handlers = auth.handler();
  const method = request.method as keyof typeof handlers;
  return handlers[method](request, context);
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE, handle as PATCH };
