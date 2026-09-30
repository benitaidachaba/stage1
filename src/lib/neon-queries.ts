import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { CloudRecord, RecordChange } from "./cloud-records";

export async function syncWithDatabase(sql: NeonQueryFunction<false, false>, ownerId: string, changes: RecordChange[]): Promise<CloudRecord[]> {
  // One atomic transaction: conditional upserts and the authoritative read.
  // A stale device cannot resurrect tombstones. Task/note timestamps resolve
  // concurrent edits; other records use optimistic version checks.
  const [, rows] = await sql.transaction([
    sql`
      insert into pocket.records (owner_id, kind, id, document, edited_at)
      select ${ownerId}, c.kind, c.id, c.document, c."editedAt"
      from jsonb_to_recordset(${JSON.stringify(changes)}::jsonb)
        as c(kind text, id text, document jsonb, "expectedVersion" integer, "editedAt" timestamptz)
      on conflict (owner_id, kind, id) do update
      set document = excluded.document, edited_at = excluded.edited_at, version = pocket.records.version + 1
      where pocket.records.version = (
        select x."expectedVersion" from jsonb_to_recordset(${JSON.stringify(changes)}::jsonb)
          as x(kind text, id text, "expectedVersion" integer)
        where x.kind = excluded.kind and x.id = excluded.id
      ) or (
        excluded.kind in ('task', 'note') and excluded.document is not null
        and pocket.records.document is not null and excluded.edited_at > pocket.records.edited_at
      )`,
    sql`select kind, id, document, version from pocket.records where owner_id = ${ownerId} order by kind, id`,
  ]);
  return rows as CloudRecord[];
}
