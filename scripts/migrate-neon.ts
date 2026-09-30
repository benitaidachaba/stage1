import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { neon } from "@neondatabase/serverless";
import { syncWithDatabase } from "../src/lib/neon-queries";
import type { RecordChange } from "../src/lib/cloud-records";

async function main() {
  const branchIndex = process.argv.indexOf("--branch");
  const branch = branchIndex >= 0 ? process.argv[branchIndex + 1] : null;
  const url = branch ? execFileSync("neon", ["connection-string", branch], { encoding: "utf8" }).trim() : process.env.DATABASE_URL_UNPOOLED;
  if (!url) throw new Error("Set DATABASE_URL_UNPOOLED or pass --branch.");
  if (new URL(url).hostname.includes("-pooler")) throw new Error("Migrations require a direct connection.");
  const sql = neon(url);
  const statements = readFileSync(new URL("../neon/schema.sql", import.meta.url), "utf8").replace(/^--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean);
  await sql.transaction(statements.map((statement) => sql.query(statement)));
  console.log(`Schema applied to ${branch ?? "linked production database"}.`);
  if (!process.argv.includes("--verify")) return;
  if (!branch) throw new Error("Verification fixtures require an isolated --branch.");
  const owner = `migration-check-${Date.now()}`;
  const change: RecordChange = { kind: "task", id: "test-task", document: { id: "test-task", title: "first" }, expectedVersion: 0, editedAt: "2026-09-30T10:00:00.000Z" };
  try {
    let rows = await syncWithDatabase(sql, owner, [change]);
    assert.equal(rows[0].version, 1);
    assert.deepEqual(await syncWithDatabase(sql, `${owner}-other`, []), []);
    rows = await syncWithDatabase(sql, owner, [{ ...change, document: { id: "test-task", title: "newer" }, editedAt: "2026-09-30T11:00:00.000Z" }]);
    assert.equal(rows[0].document?.title, "newer");
    rows = await syncWithDatabase(sql, owner, [change]);
    assert.equal(rows[0].document?.title, "newer");
    rows = await syncWithDatabase(sql, owner, [{ ...change, document: null, expectedVersion: 2 }]);
    assert.equal(rows[0].document, null);
    rows = await syncWithDatabase(sql, owner, [{ ...change, editedAt: "2030-01-01T00:00:00.000Z" }]);
    assert.equal(rows[0].document, null, "stale device must not resurrect deleted data");
    rows = await syncWithDatabase(sql, owner, [{ ...change, expectedVersion: 3 }]);
    assert.equal(rows[0].document?.title, "first", "deliberate undo can restore an acknowledged tombstone");
    const area: RecordChange = { ...change, kind: "area", id: "area-test", document: { id: "area-test", name: "Original" } };
    await syncWithDatabase(sql, owner, [area]);
    rows = await syncWithDatabase(sql, owner, [{ ...area, document: { id: "area-test", name: "Conflict" } }]);
    assert.equal(rows.find((r) => r.kind === "area")?.document?.name, "Original");
    console.log("Database checks passed: account isolation, conflict handling, tombstones, and intentional undo.");
  } finally { await sql`delete from pocket.records where owner_id = ${owner}`; }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Migration failed"); process.exitCode = 1; });
