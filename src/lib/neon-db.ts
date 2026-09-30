import "server-only";
import { neon } from "@neondatabase/serverless";
import { syncWithDatabase } from "./neon-queries";
import type { RecordChange } from "./cloud-records";

export async function syncRecords(ownerId: string, changes: RecordChange[]) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
  return syncWithDatabase(neon(process.env.DATABASE_URL), ownerId, changes);
}
