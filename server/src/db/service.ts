import pg from "pg";
import type { DbOverview, DbQueryResult, DbTable } from "@deck/shared";
import { aiComplete } from "../ai/client.js";

const { Client } = pg;

// M20 — native Postgres panel: connection test, table list with row-count
// estimates, and guarded read-only queries (typed SQL or AI-generated from a
// natural-language question). Only SELECT-shaped statements ever execute, and
// always inside a READ ONLY transaction that is rolled back.

const CONNECT_TIMEOUT_MS = 5_000;
const STATEMENT_TIMEOUT_MS = 10_000;
const MAX_ROWS = 500;

async function withClient<T>(
  url: string,
  fn: (c: InstanceType<typeof Client>) => Promise<T>,
): Promise<T> {
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    // Local dev DBs don't speak TLS; hosted URLs usually carry ?sslmode=.
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    void client.end().catch(() => {});
  }
}

export async function dbOverview(url: string): Promise<DbOverview> {
  try {
    return await withClient(url, async (c) => {
      const meta = await c.query(
        "select current_database() as db, version() as v",
      );
      const tables = await c.query(`
        select n.nspname as schema, c.relname as name,
               case when c.reltuples < 0 then null else c.reltuples::bigint end as rows
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r','p')
          and n.nspname not in ('pg_catalog','information_schema')
        order by n.nspname, c.relname
        limit 500
      `);
      const list: DbTable[] = tables.rows.map((r) => ({
        schema: String(r.schema),
        name: String(r.name),
        rows: r.rows == null ? null : Number(r.rows),
      }));
      const version = String(meta.rows[0]?.v ?? "");
      return {
        ok: true,
        database: String(meta.rows[0]?.db ?? ""),
        serverVersion: version.split(" on ")[0] ?? version,
        tables: list,
      };
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message, tables: [] };
  }
}

// A statement is runnable only if it's a single SELECT-shaped query.
function guardReadOnly(sql: string): string | null {
  const stripped = sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim()
    .replace(/;+\s*$/, "");
  if (!stripped) return null;
  if (stripped.includes(";")) return null; // one statement only
  if (!/^(select|with|explain|show|table|values)\b/i.test(stripped)) return null;
  return stripped;
}

export async function runReadOnlyQuery(
  url: string,
  sql: string,
): Promise<DbQueryResult | { error: string }> {
  const clean = guardReadOnly(sql);
  if (!clean) {
    return { error: "only single read-only (SELECT-shaped) statements run here" };
  }
  try {
    return await withClient(url, async (c) => {
      await c.query("begin transaction read only");
      await c.query(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
      try {
        const res = await c.query({ text: clean, rowMode: "array" });
        const columns = res.fields.map((f) => f.name);
        const rows = (res.rows as unknown[][]).slice(0, MAX_ROWS);
        return {
          sql: clean,
          columns,
          rows,
          rowCount: res.rowCount ?? rows.length,
          truncated: (res.rowCount ?? rows.length) > MAX_ROWS,
        };
      } finally {
        await c.query("rollback").catch(() => {});
      }
    });
  } catch (err) {
    return { error: (err as Error).message };
  }
}

// Compact schema description for the AI prompt: table(col type, …) lines.
async function schemaSummary(url: string): Promise<string> {
  return withClient(url, async (c) => {
    const res = await c.query(`
      select table_schema, table_name,
             string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position) as cols
      from information_schema.columns
      where table_schema not in ('pg_catalog','information_schema')
      group by table_schema, table_name
      order by table_schema, table_name
      limit 120
    `);
    return res.rows
      .map((r) => {
        const prefix = r.table_schema === "public" ? "" : `${r.table_schema}.`;
        return `${prefix}${r.table_name}(${r.cols})`;
      })
      .join("\n");
  });
}

export async function aiQuery(
  url: string,
  question: string,
): Promise<DbQueryResult | { error: string }> {
  let schema: string;
  try {
    schema = await schemaSummary(url);
  } catch (err) {
    return { error: `schema read failed: ${(err as Error).message}` };
  }
  const res = await aiComplete({
    feature: "dbQuery",
    system:
      "You translate questions into a single PostgreSQL SELECT statement. " +
      "Output ONLY the SQL — no markdown fences, no commentary. Never write " +
      "or modify data. Prefer explicit column lists and add LIMIT 100 unless " +
      "the question implies an aggregate.",
    prompt: `Schema:\n${schema}\n\nQuestion: ${question}\n\nSQL:`,
    maxTokens: 800,
    timeoutMs: 60_000,
  });
  if (!res?.text) return { error: "AI query generation failed (budget?)" };
  const sql = res.text.replace(/```(sql)?/gi, "").trim();
  return runReadOnlyQuery(url, sql);
}
