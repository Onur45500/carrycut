import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildSkillInputs,
  loadSkillFile,
  parseInvokedList,
  type ResolveOptions,
} from "./skills.js";
import {
  loadInvocationsFromSession,
  type FindSessionOptions,
} from "./transcript.js";
import type { SkillInput } from "../core/types.js";
import { DEFAULT_CALIBRATION } from "../core/types.js";

export interface ResolvedInvocationSource {
  skills: SkillInput[];
  warnings: string[];
  sessionPath?: string;
  lastCompactAt?: string;
  lastCompactTrigger?: string;
  lastCompactPreTokens?: number;
  /** Number of unique skills resolved from the session (before manual override). */
  sessionSkillCount?: number;
}

/**
 * Resolve skill inputs from --invoked and/or --session.
 */
export function resolveInvocationSource(options: {
  invoked?: string;
  session?: string;
  cwd?: string;
  home?: string;
  skillsRoot?: string;
  calibration?: number;
}): ResolvedInvocationSource {
  const warnings: string[] = [];
  const calibration = options.calibration ?? DEFAULT_CALIBRATION;
  const resolveOpts: ResolveOptions & { calibration: number } = {
    cwd: options.cwd,
    home: options.home,
    calibration,
    extraRoots: options.skillsRoot
      ? [resolve(options.skillsRoot)]
      : undefined,
  };

  let names: string[] = [];
  let sessionPath: string | undefined;
  let lastCompactAt: string | undefined;
  let lastCompactTrigger: string | undefined;
  let lastCompactPreTokens: number | undefined;
  let sessionSkillCount: number | undefined;
  const invokedAtByName = new Map<string, string>();

  if (options.session) {
    const sessionOpts: FindSessionOptions = {
      cwd: options.cwd,
      home: options.home,
      session: options.session,
    };
    const parsed = loadInvocationsFromSession(sessionOpts);
    warnings.push(...parsed.warnings);
    sessionPath = parsed.sessionPath;
    lastCompactAt = parsed.lastCompactAt;
    lastCompactTrigger = parsed.lastCompactTrigger;
    lastCompactPreTokens = parsed.lastCompactPreTokens;
    names = parsed.invokedNames;
    sessionSkillCount = parsed.invokedNames.length;
    for (const inv of parsed.invocations) {
      invokedAtByName.set(inv.name, inv.invokedAt);
    }
  }

  if (options.invoked) {
    const manual = parseInvokedList(options.invoked);
    if (names.length > 0) {
      warnings.push(
        "Both --invoked and --session provided; using --invoked order, merging timestamps from session when available.",
      );
    }
    names = manual;
  }

  if (names.length === 0) {
    return {
      skills: [],
      warnings: [
        ...warnings,
        "No skills to simulate. Pass --invoked skillA,skillB or --session auto.",
      ],
      sessionPath,
      lastCompactAt,
      lastCompactTrigger,
      lastCompactPreTokens,
      sessionSkillCount,
    };
  }

  const { skills, warnings: loadWarnings } = buildSkillInputs(
    names,
    resolveOpts,
  );
  warnings.push(...loadWarnings);

  for (const skill of skills) {
    const at = invokedAtByName.get(skill.name);
    if (at) skill.invokedAt = at;
  }

  return {
    skills,
    warnings,
    sessionPath,
    lastCompactAt,
    lastCompactTrigger,
    lastCompactPreTokens,
    sessionSkillCount,
  };
}

export function resolveDemoSkillsRoot(explicit?: string): string | undefined {
  if (explicit) return resolve(explicit);
  // Convenience: if demo/skills exists next to cwd or package, use it when asked
  const candidate = resolve(process.cwd(), "demo", "skills");
  if (existsSync(candidate)) return candidate;
  return undefined;
}

export { loadSkillFile, parseInvokedList };
