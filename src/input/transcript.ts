import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface TranscriptInvocation {
  name: string;
  invokedAt: string;
  /** Order within the session: higher = more recent. */
  position: number;
}

export interface TranscriptParseResult {
  invocations: TranscriptInvocation[];
  /** Unique skills in invocation order (oldest → newest). */
  invokedNames: string[];
  sessionPath?: string;
  /** ISO timestamp of the most recent compact boundary / summary. */
  lastCompactAt?: string;
  /** From compactMetadata.trigger: "auto" | "manual" | other. */
  lastCompactTrigger?: string;
  /** From compactMetadata.preTokens when present. */
  lastCompactPreTokens?: number;
  warnings: string[];
}

export interface CompactDetection {
  compacted: boolean;
  at?: string;
  /** Boundary marker vs synthetic summary vs legacy heuristics. */
  kind?: "compact_boundary" | "compact_summary" | "legacy";
  trigger?: string;
  preTokens?: number;
}

interface JsonlRecord {
  type?: string;
  subtype?: string;
  timestamp?: string;
  cwd?: string;
  isCompactSummary?: boolean;
  compactMetadata?: unknown;
  compact_metadata?: unknown;
  message?: {
    role?: string;
    content?: unknown;
  };
  [key: string]: unknown;
}

const BUILTIN_COMMANDS = new Set([
  "compact",
  "help",
  "clear",
  "cost",
  "model",
  "permissions",
  "doctor",
  "memory",
  "init",
  "login",
  "logout",
  "vim",
  "diff",
  "export",
  "status",
  "config",
  "bug",
]);

function isBuiltinCommand(name: string): boolean {
  return BUILTIN_COMMANDS.has(name.toLowerCase());
}

function extractSlashCommands(text: string, pushName: (raw: string) => void): void {
  const matches = text.matchAll(/(?:^|\s)\/([a-zA-Z0-9][\w-]*)/g);
  for (const m of matches) {
    if (isBuiltinCommand(m[1])) continue;
    pushName(m[1]);
  }
}

/**
 * Detect Claude Code compaction markers in a transcript record.
 *
 * Preferred signals (real session JSONL):
 * - system subtype compact_boundary + compactMetadata.trigger / preTokens
 * - user message with isCompactSummary: true
 *
 * Legacy heuristics kept as fallback for older/fixture formats.
 */
export function detectCompactEvent(record: JsonlRecord): CompactDetection {
  const ts =
    typeof record.timestamp === "string" && record.timestamp
      ? record.timestamp
      : undefined;

  const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
  const subtype =
    typeof record.subtype === "string" ? record.subtype.toLowerCase() : "";

  // Official boundary: { type: "system", subtype: "compact_boundary", compactMetadata }
  if (type === "system" && subtype === "compact_boundary") {
    const meta = readCompactMetadata(record);
    return {
      compacted: true,
      at: ts,
      kind: "compact_boundary",
      trigger: meta.trigger,
      preTokens: meta.preTokens,
    };
  }

  // Official summary line: { type: "user", isCompactSummary: true, ... }
  if (record.isCompactSummary === true) {
    const meta = readCompactMetadata(record);
    return {
      compacted: true,
      at: ts,
      kind: "compact_summary",
      trigger: meta.trigger,
      preTokens: meta.preTokens,
    };
  }

  // camelCase / snake_case metadata without subtype (defensive)
  const meta = readCompactMetadata(record);
  if (meta.trigger || meta.preTokens != null) {
    return {
      compacted: true,
      at: ts,
      kind: "compact_boundary",
      trigger: meta.trigger,
      preTokens: meta.preTokens,
    };
  }

  if (
    type.includes("compact") ||
    type === "summary" ||
    type === "conversation_compacted"
  ) {
    return { compacted: true, at: ts, kind: "legacy" };
  }

  const scanText = (text: string): boolean => {
    if (/(?:^|\s)\/compact(?:\s|$)/i.test(text)) return true;
    if (/\bauto-?compaction\b/i.test(text)) return true;
    if (/\bconversation (was )?compacted\b/i.test(text)) return true;
    return false;
  };

  const walk = (value: unknown): boolean => {
    if (value == null) return false;
    if (typeof value === "string") return scanText(value);
    if (Array.isArray(value)) return value.some(walk);
    if (typeof value !== "object") return false;
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === "string" && scanText(obj.text)) return true;
    if (typeof obj.content === "string" && scanText(obj.content)) return true;
    if (obj.isCompact === true || obj.compacted === true) return true;
    return Object.values(obj).some(walk);
  };

  if (walk(record)) return { compacted: true, at: ts, kind: "legacy" };
  return { compacted: false };
}

function readCompactMetadata(record: JsonlRecord): {
  trigger?: string;
  preTokens?: number;
} {
  const raw = record.compactMetadata ?? record.compact_metadata;
  if (!raw || typeof raw !== "object") return {};
  const meta = raw as Record<string, unknown>;
  const trigger =
    typeof meta.trigger === "string"
      ? meta.trigger
      : typeof meta.Trigger === "string"
        ? meta.Trigger
        : undefined;
  const preRaw = meta.preTokens ?? meta.pre_tokens;
  const preTokens =
    typeof preRaw === "number" && Number.isFinite(preRaw) ? preRaw : undefined;
  return { trigger, preTokens };
}

/**
 * Best-effort extraction of skill names from a Claude Code transcript JSONL line.
 * Claude Code formats evolve; we look for common patterns without crashing.
 */
export function extractSkillNamesFromRecord(record: JsonlRecord): string[] {
  // Compact summaries are machine-generated continuity text — do not mine for /skills
  if (record.isCompactSummary === true) return [];

  const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
  const subtype =
    typeof record.subtype === "string" ? record.subtype.toLowerCase() : "";
  if (type === "system" && subtype === "compact_boundary") return [];

  const names: string[] = [];

  const pushName = (raw: string) => {
    const cleaned = raw
      .replace(/^\/+/, "")
      .replace(/\.md$/i, "")
      .trim();
    // SlashCommand sometimes passes "/skill-name args"
    const firstToken = cleaned.split(/[\s#]/)[0] ?? "";
    if (
      firstToken &&
      !firstToken.includes(" ") &&
      firstToken.length < 128 &&
      !isBuiltinCommand(firstToken)
    ) {
      names.push(firstToken);
    }
  };

  const walk = (value: unknown): void => {
    if (value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value !== "object") return;

    const obj = value as Record<string, unknown>;
    const type = typeof obj.type === "string" ? obj.type : "";
    const name = typeof obj.name === "string" ? obj.name : "";

    const looksLikeSkillTool =
      type === "tool_use" &&
      (name === "Skill" ||
        name === "skill" ||
        name === "SlashCommand" ||
        name === "slash_command" ||
        name.toLowerCase() === "skill");

    if (looksLikeSkillTool && obj.input && typeof obj.input === "object") {
      const input = obj.input as Record<string, unknown>;
      for (const key of [
        "skill",
        "name",
        "command",
        "slash_command",
        "skill_name",
        "skillName",
      ]) {
        if (typeof input[key] === "string") {
          pushName(input[key] as string);
        }
      }
      // Nested wrappers: input.args.skill
      if (input.args && typeof input.args === "object") {
        const args = input.args as Record<string, unknown>;
        for (const key of ["skill", "name", "command"]) {
          if (typeof args[key] === "string") pushName(args[key] as string);
        }
      }
    }

    // User typed /skill-name as plain string
    if (typeof obj.content === "string") {
      extractSlashCommands(obj.content, pushName);
    }

    // Newer transcripts: content is [{ type: "text", text: "..." }]
    if (Array.isArray(obj.content)) {
      for (const block of obj.content) {
        if (block && typeof block === "object") {
          const b = block as Record<string, unknown>;
          if (typeof b.text === "string") {
            extractSlashCommands(b.text, pushName);
          }
        }
      }
    }

    if (typeof obj.text === "string") {
      extractSlashCommands(obj.text, pushName);
    }

    for (const v of Object.values(obj)) walk(v);
  };

  walk(record);
  if (record.message) walk(record.message);

  return [...new Set(names)];
}

function parseTimestamp(record: JsonlRecord, lineIndex: number): string {
  if (typeof record.timestamp === "string" && record.timestamp) {
    return record.timestamp;
  }
  return new Date(lineIndex * 1000).toISOString();
}

/**
 * Parse a Claude Code session JSONL file for skill invocations.
 */
export function parseTranscriptFile(filePath: string): TranscriptParseResult {
  const warnings: string[] = [];
  const invocations: TranscriptInvocation[] = [];
  let lastCompactAt: string | undefined;
  let lastCompactTrigger: string | undefined;
  let lastCompactPreTokens: number | undefined;

  if (!existsSync(filePath)) {
    return {
      invocations: [],
      invokedNames: [],
      sessionPath: filePath,
      warnings: [`Session file not found: ${filePath}`],
    };
  }

  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      invocations: [],
      invokedNames: [],
      sessionPath: filePath,
      warnings: [`Failed to read session file: ${message}`],
    };
  }

  const lines = content.split(/\r?\n/);
  let position = 0;
  let parsedLines = 0;
  let skillHits = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;

    let record: JsonlRecord;
    try {
      record = JSON.parse(line) as JsonlRecord;
      parsedLines++;
    } catch {
      continue;
    }

    const compact = detectCompactEvent(record);
    if (compact.compacted) {
      lastCompactAt = compact.at ?? parseTimestamp(record, i);
      // Prefer boundary metadata (has trigger/preTokens) over summary-only lines
      if (compact.trigger) lastCompactTrigger = compact.trigger;
      if (compact.preTokens != null) lastCompactPreTokens = compact.preTokens;
    }

    const names = extractSkillNamesFromRecord(record);
    if (names.length === 0) continue;

    skillHits += names.length;
    const invokedAt = parseTimestamp(record, i);
    for (const name of names) {
      invocations.push({ name, invokedAt, position: position++ });
    }
  }

  if (parsedLines === 0) {
    warnings.push(
      "Session file contained no valid JSONL records — format may have changed.",
    );
  } else if (skillHits === 0) {
    warnings.push(
      "No skill invocations detected in session transcript. Use --invoked to specify skills manually.",
    );
  }

  if (lastCompactAt) {
    const triggerPart = lastCompactTrigger
      ? ` (trigger: ${lastCompactTrigger})`
      : "";
    const prePart =
      lastCompactPreTokens != null
        ? ` · preTokens≈${lastCompactPreTokens}`
        : "";
    warnings.push(
      `Transcript shows a compaction event at ${lastCompactAt}${triggerPart}${prePart} — skills listed are post-reattach candidates from invocations in this session.`,
    );
  }

  const lastByName = new Map<string, TranscriptInvocation>();
  for (const inv of invocations) {
    lastByName.set(inv.name, inv);
  }
  const uniqueSorted = [...lastByName.values()].sort(
    (a, b) => a.position - b.position,
  );

  return {
    invocations: uniqueSorted.map((inv, idx) => ({
      ...inv,
      position: idx,
    })),
    invokedNames: uniqueSorted.map((inv) => inv.name),
    sessionPath: resolve(filePath),
    lastCompactAt,
    lastCompactTrigger,
    lastCompactPreTokens,
    warnings,
  };
}

/**
 * Generate candidate encodings Claude Code may use under ~/.claude/projects/.
 */
export function encodeProjectPathVariants(cwd: string): string[] {
  const normalized = cwd.replace(/\\/g, "/");
  const noTrailing = normalized.replace(/\/+$/, "");
  const withTrailing = noTrailing + "/";

  const encode = (p: string) =>
    p.replace(/\\/g, "/").replace(/:/g, "-").replace(/\//g, "-");

  const variants = new Set<string>();
  for (const form of [cwd, normalized, noTrailing, withTrailing]) {
    const enc = encode(form);
    variants.add(enc);
    variants.add(enc.replace(/^-/, ""));
    // Sometimes leading slash becomes leading dash: -G-DEV-carrycut
    if (!enc.startsWith("-") && /^[A-Za-z]-/.test(enc)) {
      variants.add("-" + enc);
    }
  }

  // Lowercase drive letter variant (g-DEV-... vs G-DEV-...)
  for (const v of [...variants]) {
    variants.add(v.replace(/^(-?)([A-Za-z])(-)/, (_, a, d, c) => a + d.toLowerCase() + c));
    variants.add(v.replace(/^(-?)([A-Za-z])(-)/, (_, a, d, c) => a + d.toUpperCase() + c));
  }

  return [...variants];
}

export function encodeProjectPath(cwd: string): string {
  return encodeProjectPathVariants(cwd)[0] ?? cwd.replace(/[/\\:]/g, "-");
}

export interface FindSessionOptions {
  cwd?: string;
  home?: string;
  /** Explicit path to a .jsonl session file or a project directory. */
  session?: string;
}

/**
 * Locate the most recently modified session JSONL for the current project.
 */
export function findLatestSession(
  options: FindSessionOptions = {},
): { path?: string; warnings: string[] } {
  const warnings: string[] = [];
  const home = options.home ?? homedir();
  const cwd = options.cwd ?? process.cwd();

  if (options.session && options.session !== "auto") {
    const explicit = resolve(options.session);
    if (existsSync(explicit)) {
      const stats = statSync(explicit);
      if (stats.isFile()) {
        return { path: explicit, warnings };
      }
      const latest = pickLatestJsonl(explicit);
      if (latest) return { path: latest, warnings };
      warnings.push(`No .jsonl session files found in ${explicit}`);
      return { warnings };
    }
    warnings.push(`Session path not found: ${explicit}`);
    return { warnings };
  }

  const projectsRoot = join(home, ".claude", "projects");
  if (!existsSync(projectsRoot)) {
    warnings.push(
      `Claude Code projects directory not found at ${projectsRoot}. Use --invoked instead.`,
    );
    return { warnings };
  }

  const candidates: string[] = [];
  for (const enc of encodeProjectPathVariants(cwd)) {
    candidates.push(join(projectsRoot, enc));
  }

  // Fuzzy: match path fragments against existing project dirs
  try {
    const dirs = readdirSync(projectsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    const parts = cwd
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean);
    const cwdBase = parts.slice(-2).join("-");
    const cwdTail = parts.slice(-1)[0] ?? "";
    const encoded = encodeProjectPath(cwd);

    for (const d of dirs) {
      if (
        d.includes(cwdBase) ||
        (cwdTail.length > 2 && d.includes(cwdTail)) ||
        encoded.includes(d) ||
        d.includes(encoded.slice(-40))
      ) {
        candidates.push(join(projectsRoot, d));
      }
    }
  } catch {
    // ignore
  }

  const seen = new Set<string>();
  for (const dir of candidates) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    if (!existsSync(dir)) continue;
    const latest = pickLatestJsonl(dir);
    if (latest) return { path: latest, warnings };
  }

  warnings.push(
    `No session transcript found for project ${cwd}. Use --invoked to specify skills manually.`,
  );
  return { warnings };
}

function pickLatestJsonl(dir: string): string | undefined {
  let best: { path: string; mtime: number } | undefined;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return undefined;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    const full = join(dir, entry);
    try {
      const mtime = statSync(full).mtimeMs;
      if (!best || mtime > best.mtime) {
        best = { path: full, mtime };
      }
    } catch {
      // skip
    }
  }
  return best?.path;
}

/**
 * Auto-detect invoked skills from the latest (or given) session transcript.
 */
export function loadInvocationsFromSession(
  options: FindSessionOptions = {},
): TranscriptParseResult {
  const { path, warnings: findWarnings } = findLatestSession(options);
  if (!path) {
    return {
      invocations: [],
      invokedNames: [],
      warnings: findWarnings,
    };
  }

  const parsed = parseTranscriptFile(path);
  return {
    ...parsed,
    warnings: [...findWarnings, ...parsed.warnings],
  };
}
