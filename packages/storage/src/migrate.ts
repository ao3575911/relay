import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('relay-schema-migrations'))");
    await client.query("CREATE TABLE IF NOT EXISTS relay_schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
    for (const name of (await readdir(dir)).filter((entry) => /^\d+_[a-z0-9_]+\.sql$/.test(entry)).sort()) {
      const found = await client.query("SELECT 1 FROM relay_schema_migrations WHERE name = $1", [name]);
      if (found.rowCount) continue;
      await client.query("BEGIN");
      try {
        await client.query(await readFile(path.join(dir, name), "utf8"));
        await client.query("INSERT INTO relay_schema_migrations(name) VALUES ($1)", [name]);
        await client.query("COMMIT");
        process.stdout.write(`Applied ${name}\n`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('relay-schema-migrations'))").catch(() => {});
    client.release();
    await pool.end();
  }
}
main().catch(() => { console.error("Database migration failed; check the connection and migration permissions."); process.exitCode = 1; });
