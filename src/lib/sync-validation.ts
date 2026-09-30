import { z } from "zod";
import { recordKey } from "./cloud-records";

export const syncRequestSchema = z.object({
  accountId: z.string().min(1).max(200),
  changes: z.array(z.object({
    kind: z.enum(["task", "note", "area", "event", "settings"]),
    id: z.string().min(1).max(200),
    document: z.record(z.string(), z.unknown()).nullable(),
    expectedVersion: z.number().int().min(0).max(2147483646),
    editedAt: z.iso.datetime(),
  }).superRefine((change, ctx) => {
    if (change.kind === "settings" && change.id !== "preferences") ctx.addIssue({ code: "custom", message: "Invalid settings ID" });
    if (change.kind !== "settings" && change.document && change.document.id !== change.id) ctx.addIssue({ code: "custom", message: "Record ID mismatch" });
  })).max(10000),
}).superRefine(({ changes }, ctx) => {
  if (new Set(changes.map(recordKey)).size !== changes.length) ctx.addIssue({ code: "custom", message: "Duplicate records" });
});
