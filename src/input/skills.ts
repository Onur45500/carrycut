import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { countTokens } from "../core/tokens.js";
import type { SkillInput } from "../core/types.js";

/** Matches Claude Code dynamic context injection: !`command` */
const DYNAMIC_CONTEXT_RE = /!`[^`]+`/;

/**
 * Strip YAML frontmatter (--- ... ---) from the start of a SKILL.md body.
 * Returns the body that would be rendered into context (approximation).
 */
export function stripFrontmatter(content: string): string {
  const trimmed = content.replace(/^\uFEFF/, "");
  if (!trimmed.startsWith("---")) {
    return trimmed;
  }
  const end = trimmed.indexOf("\n---", 3);
  if (end === -1) {
    return trimmed;
  }
  let body = trimmed.slice(end + 4);
  if (body.startsWith("\n")) body = body.slice(1);
  return body;
}

export function hasDynamicContext(body: string): boolean {
  return DYNAMIC_CONTEXT_RE.test(body);
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export interface ResolveOptions {
  /** Project root (default: cwd). */
  cwd?: string;
  /** Home directory override (tests). */
  home?: string;
  /** Extra search roots, checked after project and before home. */
  extraRoots?: string[];
}

/**
 * Resolve SKILL.md for a skill name.
 * Order: <cwd>/.claude/skills/<name>/SKILL.md, then ~/.claude/skills/<name>/SKILL.md
 */
export function resolveSkillPath(
  name: string,
  options: ResolveOptions = {},
): string | undefined {
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? homedir();
  const candidates = [
    join(cwd, ".claude", "skills", name, "SKILL.md"),
    ...(options.extraRoots ?? []).map((root) =>
      join(root, name, "SKILL.md"),
    ),
    join(home, ".claude", "skills", name, "SKILL.md"),
  ];

  for (const path of candidates) {
    if (existsSync(path)) return resolve(path);
  }
  return undefined;
}

export interface LoadedSkill {
  name: string;
  path: string;
  raw: string;
  body: string;
  tokens: number;
  hasDynamicContext: boolean;
  mtime: string;
  contentHash: string;
}

export function loadSkillFile(
  name: string,
  options: ResolveOptions & { calibration?: number } = {},
): LoadedSkill | undefined {
  const path = resolveSkillPath(name, options);
  if (!path) return undefined;

  const raw = readFileSync(path, "utf8");
  const body = stripFrontmatter(raw);
  const stats = statSync(path);

  return {
    name,
    path,
    raw,
    body,
    tokens: countTokens(body, options.calibration),
    hasDynamicContext: hasDynamicContext(body),
    mtime: stats.mtime.toISOString(),
    contentHash: hashContent(raw),
  };
}

/**
 * Build SkillInput[] from an ordered invocation list.
 * Last name in the list = most recently invoked (highest position).
 */
export function buildSkillInputs(
  invokedNames: string[],
  options: ResolveOptions & { calibration?: number } = {},
): { skills: SkillInput[]; warnings: string[]; missing: string[] } {
  const warnings: string[] = [];
  const missing: string[] = [];
  const skills: SkillInput[] = [];

  invokedNames.forEach((name, index) => {
    const loaded = loadSkillFile(name, options);
    if (!loaded) {
      missing.push(name);
      warnings.push(
        `Skill "${name}" not found in .claude/skills/ or ~/.claude/skills/ — using 0 tokens.`,
      );
      skills.push({
        name,
        tokens: 0,
        position: index,
        hasDynamicContext: false,
      });
      return;
    }

    if (loaded.hasDynamicContext) {
      warnings.push(
        `Skill "${name}" uses dynamic context (!\`cmd\`) — token count is an estimate of the static body only.`,
      );
    }

    skills.push({
      name: loaded.name,
      tokens: loaded.tokens,
      position: index,
      hasDynamicContext: loaded.hasDynamicContext,
      path: loaded.path,
      mtime: loaded.mtime,
      contentHash: loaded.contentHash,
    });
  });

  return { skills, warnings, missing };
}

export function parseInvokedList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
