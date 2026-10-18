import { createHash, randomUUID } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export const hash = (value) => createHash("sha256").update(value).digest("hex");

// One bridge process owns this directory. Records deliberately have no automatic expiry.
export function createEventStore({ dataDir } = {}) {
  if (dataDir !== undefined && (typeof dataDir !== "string" || !dataDir.trim())) {
    throw new Error("dataDir must be a non-empty path");
  }
  const memory = new Map();
  if (dataDir) mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  return {
    get(eventHash) {
      if (!dataDir) return memory.get(eventHash);
      let record;
      try {
        record = JSON.parse(readFileSync(join(dataDir, `${eventHash}.json`), "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") return undefined;
        throw error;
      }
      if (record.eventHash !== eventHash || !/^[a-f0-9]{64}$/.test(record.transcriptHash)
        || !["pending", "completed", "failed"].includes(record.status)
        || !Number.isFinite(record.createdAt) || !Number.isFinite(record.updatedAt)) {
        throw new Error("Invalid event metadata");
      }
      return record;
    },
    set(record) {
      if (!dataDir) return memory.set(record.eventHash, record);
      const temporary = join(dataDir, `.${randomUUID()}.tmp`);
      let file;
      try {
        file = openSync(temporary, "wx", 0o600);
        writeFileSync(file, JSON.stringify(record));
        fsyncSync(file);
        closeSync(file);
        file = undefined;
        renameSync(temporary, join(dataDir, `${record.eventHash}.json`));
        const directory = openSync(dataDir, "r");
        try { fsyncSync(directory); } finally { closeSync(directory); }
      } finally {
        if (file !== undefined) closeSync(file);
        try { unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
      }
    },
  };
}
