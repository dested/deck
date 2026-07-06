import fs from "node:fs";
import path from "node:path";
import type {
  EnvFile,
  EnvVar,
  EnvVarCategory,
  StackBadge,
  StackReport,
} from "@deck/shared";
import { config } from "../config.js";
import { inspectProject } from "../projects/inspector.js";

// M20 — env intelligence. Walks the repo (4 dirs deep, monorepo-aware) for
// .env* files, tags each file with its nearest workspace (package.json) and
// each var with a rough category, detects the stack (AI providers, databases,
// Prisma), and edits vars in place with a timestamped backup. Values NEVER
// leave this module masked-off: the reveal/edit paths return them only over
// explicit endpoints, and nothing here ever feeds values to AI.

const ENV_FILE_RE = /^\.env(\..+)?$/;
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "target",
  "tmp",
  "temp",
  "__pycache__",
  "venv",
]);
// Dot-dirs (.git, .next, .turbo, .vercel, .venv, …) are skipped wholesale.
const MAX_DEPTH = 4; // dir levels below the repo root
const MAX_DIRS = 1500; // hard stop for pathological trees
const READ_CAP = 64 * 1024;
const BACKUPS_DIR = path.join(config.deckStateDir, "env-backups");

interface ParsedVar {
  key: string;
  value: string;
}

function parseEnv(src: string): ParsedVar[] {
  const out: ParsedVar[] = [];
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2]!.trim();
    // Strip a trailing same-line comment only when the value is unquoted.
    if (!/^["']/.test(value)) value = value.replace(/\s+#.*$/, "").trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out.push({ key: m[1]!, value });
  }
  return out;
}

function mask(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "•".repeat(Math.max(3, value.length));
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

// One BFS over the repo tree (MAX_DEPTH levels, skip list above) collecting
// everything the stack report needs: env files, prisma schemas, and every
// package.json's name for workspace attribution.
interface TreeScan {
  envFiles: string[]; // repo-relative, forward-slash
  prismaSchemas: string[];
  packages: Map<string, string>; // relDir ("" = root) -> package name / relDir
}

function scanTree(projectPath: string): TreeScan {
  const scan: TreeScan = { envFiles: [], prismaSchemas: [], packages: new Map() };
  const queue = [{ abs: projectPath, rel: "", depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && visited < MAX_DIRS) {
    const { abs, rel, depth } = queue.shift()!;
    visited++;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isFile()) {
        if (ENV_FILE_RE.test(e.name)) scan.envFiles.push(rel + e.name);
        else if (e.name === "schema.prisma") scan.prismaSchemas.push(rel + e.name);
        else if (e.name === "package.json") {
          const dir = rel.replace(/\/$/, "");
          try {
            const pkg = JSON.parse(
              fs.readFileSync(path.win32.join(abs, e.name), "utf8").slice(0, READ_CAP),
            ) as { name?: unknown };
            scan.packages.set(
              dir,
              typeof pkg.name === "string" && pkg.name ? pkg.name : dir,
            );
          } catch {
            scan.packages.set(dir, dir);
          }
        }
      } else if (
        e.isDirectory() &&
        depth < MAX_DEPTH &&
        !SKIP_DIRS.has(e.name) &&
        !e.name.startsWith(".")
      ) {
        queue.push({
          abs: path.win32.join(abs, e.name),
          rel: `${rel}${e.name}/`,
          depth: depth + 1,
        });
      }
    }
  }
  scan.envFiles.sort();
  scan.prismaSchemas.sort((a, b) => a.split("/").length - b.split("/").length);
  return scan;
}

// Nearest enclosing package.json for an env file; null = the repo root owns it.
function workspaceFor(relFile: string, packages: Map<string, string>): string | null {
  const segs = relFile.split("/").slice(0, -1);
  for (let i = segs.length; i > 0; i--) {
    const dir = segs.slice(0, i).join("/");
    const name = packages.get(dir);
    if (name != null) return name;
  }
  return null;
}

// Rough key classification — order matters (DATABASE_URL is db, not urls).
const CATEGORY_RULES: [EnvVarCategory, RegExp][] = [
  ["ai", /^(ANTHROPIC|OPENAI|GEMINI|GOOGLE_AI|GROQ|MISTRAL|OPENROUTER|HUGGINGFACE|HF_|REPLICATE|CLAUDE|AI_|LLM|TOGETHER|XAI|ELEVENLABS|DEEPGRAM)/,],
  ["database", /^(DATABASE|DIRECT_URL|POSTGRES|PG_|PG(HOST|PORT|USER|PASSWORD|DATABASE)|MYSQL|MONGO|SQLITE|REDIS|UPSTASH|SUPABASE|PRISMA|DRIZZLE|TURSO|PLANETSCALE|NEON|DB_)/,],
  ["payments", /^(STRIPE|PAYPAL|PADDLE|LEMON_?SQUEEZY|SQUARE_)/],
  ["storage", /^(S3_|AWS_|R2_|BLOB|BUCKET|CLOUDINARY|UPLOADTHING|MINIO|GCS_|STORAGE)/],
  ["email", /^(SMTP|MAIL|EMAIL|RESEND|SENDGRID|POSTMARK|SES_|MAILGUN)/],
  ["auth", /^(AUTH|NEXTAUTH|CLERK|JWT|SESSION|COOKIE|OAUTH|GITHUB_(CLIENT|SECRET|TOKEN)|GOOGLE_CLIENT|DISCORD_(CLIENT|SECRET|TOKEN|BOT)|TWITCH|API_KEY|SECRET|.*_SECRET$|.*_API_KEY$|.*_TOKEN$|.*_PASSWORD$)/,],
  ["urls", /(^(HOST|PORT|ORIGIN|DOMAIN)$)|(_URL$|_URI$|_HOST$|_PORT$|_ENDPOINT$|_ORIGIN$|_DOMAIN$)/],
  ["config", /^(NODE_ENV|ENV|DEBUG|LOG|VERBOSE|ENABLE|DISABLE|FEATURE|FLAG|MODE$|.*_MODE$|.*_ENABLED$)/],
];

function categorize(key: string): EnvVarCategory {
  const k = key.toUpperCase();
  for (const [cat, re] of CATEGORY_RULES) if (re.test(k)) return cat;
  return "other";
}

function readEnvFile(projectPath: string, relFile: string): ParsedVar[] {
  const abs = path.win32.join(projectPath, ...relFile.split("/"));
  try {
    const src = fs.readFileSync(abs, "utf8").slice(0, READ_CAP);
    return parseEnv(src);
  } catch {
    return [];
  }
}

function dbProvider(url: string): "postgres" | "mysql" | "sqlite" | "other" {
  if (/^postgres(ql)?:/i.test(url)) return "postgres";
  if (/^mysql:/i.test(url)) return "mysql";
  if (/^(file:|sqlite:)/i.test(url)) return "sqlite";
  return "other";
}

const DB_URL_KEYS = /^(DATABASE_URL|DIRECT_URL|POSTGRES_URL|PG_URL|POSTGRES_PRISMA_URL)/;

export function stackReport(projectId: string, projectPath: string): StackReport {
  const files: EnvFile[] = [];
  const badges = new Set<StackBadge>();
  let databaseUrl: StackReport["databaseUrl"] = null;

  const scan = scanTree(projectPath);
  for (const relFile of scan.envFiles) {
    const vars = readEnvFile(projectPath, relFile);
    const view: EnvVar[] = vars.map((v) => ({
      key: v.key,
      masked: mask(v.value),
      hasValue: v.value.length > 0,
      category: categorize(v.key),
    }));
    files.push({
      path: relFile,
      vars: view,
      workspace: workspaceFor(relFile, scan.packages),
    });

    const isExample = /example|sample|template/i.test(relFile);
    for (const v of vars) {
      const k = v.key.toUpperCase();
      if (k.startsWith("ANTHROPIC")) badges.add("anthropic");
      if (k.startsWith("OPENAI")) badges.add("openai");
      if (k.startsWith("REDIS") || /^redis:/i.test(v.value)) badges.add("redis");
      if (k.startsWith("SUPABASE")) badges.add("supabase");
      if (k.startsWith("STRIPE")) badges.add("stripe");
      if (k.startsWith("AWS_") || k.startsWith("S3_")) badges.add("s3");
      const looksDbUrl = DB_URL_KEYS.test(k) || /^postgres(ql)?:\/\//i.test(v.value);
      if (looksDbUrl && v.value) {
        const provider = dbProvider(v.value);
        if (provider === "postgres") badges.add("postgres");
        if (provider === "mysql") badges.add("mysql");
        if (provider === "sqlite") badges.add("sqlite");
        // First real (non-example) postgres URL wins; any URL beats nothing.
        const better =
          !databaseUrl ||
          (provider === "postgres" && databaseUrl.provider !== "postgres");
        if (better && !isExample) {
          databaseUrl = {
            file: relFile,
            key: v.key,
            masked: mask(v.value),
            provider,
          };
        }
      }
    }
  }

  const insp = inspectProject(projectId, projectPath);
  if (insp.frameworks.includes("Prisma")) badges.add("prisma");
  if (insp.frameworks.includes("Drizzle")) badges.add("drizzle");
  // Shallowest schema wins (scanTree sorts by path depth).
  const prismaSchemaPath = scan.prismaSchemas[0] ?? null;
  if (prismaSchemaPath) badges.add("prisma");

  return {
    projectId,
    files,
    badges: [...badges],
    databaseUrl,
    prismaSchemaPath,
  };
}

export function revealEnvVar(
  projectPath: string,
  relFile: string,
  key: string,
): string | null {
  if (relFile.includes("..")) return null;
  const v = readEnvFile(projectPath, relFile).find((x) => x.key === key);
  return v?.value ?? null;
}

// The DB connection string for a project (real value — internal use + db routes).
export function connectionString(
  projectId: string,
  projectPath: string,
): string | null {
  const report = stackReport(projectId, projectPath);
  if (!report.databaseUrl) return null;
  return revealEnvVar(projectPath, report.databaseUrl.file, report.databaseUrl.key);
}

// Edit (or append) KEY=value in an env file, backing up the original first.
export function setEnvVar(
  projectId: string,
  projectPath: string,
  relFile: string,
  key: string,
  value: string,
): { ok: boolean; error?: string } {
  if (relFile.includes("..") || !ENV_FILE_RE.test(path.posix.basename(relFile))) {
    return { ok: false, error: "not an env file" };
  }
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key)) {
    return { ok: false, error: "invalid key" };
  }
  const abs = path.win32.join(projectPath, ...relFile.split("/"));
  let src: string;
  try {
    src = fs.readFileSync(abs, "utf8");
  } catch {
    return { ok: false, error: "env file not found" };
  }

  try {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safe = `${projectId}-${relFile.replace(/[\\/]/g, "_")}-${stamp}.bak`;
    fs.writeFileSync(path.join(BACKUPS_DIR, safe), src, "utf8");
  } catch {
    /* backup is best-effort; still proceed */
  }

  // Quote when the value has spaces or a # (would be eaten as a comment).
  const rendered = /[\s#]/.test(value) ? `"${value}"` : value;
  const lineRe = new RegExp(`^(\\s*(?:export\\s+)?${key}\\s*=).*$`, "m");
  const next = lineRe.test(src)
    ? src.replace(lineRe, `$1${rendered}`)
    : src.replace(/\n?$/, `\n${key}=${rendered}\n`);
  try {
    fs.writeFileSync(abs, next, "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
