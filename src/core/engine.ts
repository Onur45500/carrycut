import {
  COMBINED_BUDGET,
  SKILL_TOKEN_CAP,
  type CompactionResult,
  type SkillInput,
  type SkillResult,
  type SkillStatus,
} from "./types.js";

/**
 * Deduplicate by name, keeping the most recent invocation (highest position).
 * Mirrors Claude Code: only the most recent invocation of each skill is re-attached.
 */
export function dedupeNewest(skills: SkillInput[]): SkillInput[] {
  const byName = new Map<string, SkillInput>();
  for (const skill of skills) {
    const existing = byName.get(skill.name);
    if (!existing || skill.position > existing.position) {
      byName.set(skill.name, skill);
    }
  }
  return [...byName.values()].sort((a, b) => b.position - a.position);
}

function classify(
  tokens: number,
  capped: number,
  kept: number,
): SkillStatus {
  if (kept === 0) return "DROP";
  if (kept < tokens || capped < tokens) return "TRUNCATE";
  return "KEEP";
}

/**
 * Simulate Claude Code skill re-attachment after auto-compaction.
 *
 * Rules (verified 2026-09-10 against https://code.claude.com/docs/en/skills):
 * 1. Each skill keeps at most the first SKILL_TOKEN_CAP tokens.
 * 2. All re-attached skills share COMBINED_BUDGET tokens.
 * 3. Budget is filled newest-first; older skills are dropped entirely when exhausted.
 * 4. Identical re-invocations are already collapsed by dedupeNewest.
 */
export function simulateCompaction(
  skills: SkillInput[],
  options?: { skillCap?: number; combinedBudget?: number },
): CompactionResult {
  const skillCap = options?.skillCap ?? SKILL_TOKEN_CAP;
  const combinedBudget = options?.combinedBudget ?? COMBINED_BUDGET;

  const ordered = dedupeNewest(skills);
  let remaining = combinedBudget;
  const results: SkillResult[] = [];

  for (const skill of ordered) {
    const capped = Math.min(skill.tokens, skillCap);

    if (remaining <= 0) {
      results.push({
        name: skill.name,
        status: "DROP",
        tokens: skill.tokens,
        keptTokens: 0,
        skillCap,
        hasDynamicContext: skill.hasDynamicContext ?? false,
        path: skill.path,
        invokedAt: skill.invokedAt,
        mtime: skill.mtime,
        contentHash: skill.contentHash,
        budgetRemaining: 0,
      });
      continue;
    }

    const kept = Math.min(capped, remaining);
    remaining -= kept;

    results.push({
      name: skill.name,
      status: classify(skill.tokens, capped, kept),
      tokens: skill.tokens,
      keptTokens: kept,
      skillCap,
      hasDynamicContext: skill.hasDynamicContext ?? false,
      path: skill.path,
      invokedAt: skill.invokedAt,
      mtime: skill.mtime,
      contentHash: skill.contentHash,
      budgetRemaining: remaining,
    });
  }

  // Present oldest → newest for human-readable tables (invocation order),
  // but computation was newest-first.
  const byPositionAsc = [...results].sort((a, b) => {
    const posA = ordered.find((s) => s.name === a.name)?.position ?? 0;
    const posB = ordered.find((s) => s.name === b.name)?.position ?? 0;
    return posA - posB;
  });

  const budgetUsed = combinedBudget - remaining;

  return {
    skills: byPositionAsc,
    combinedBudget,
    budgetUsed,
    budgetRemaining: remaining,
  };
}

/**
 * Suggest re-invoking skills that would be lost after compaction.
 * - Without --critical: suggest only for DROP (the silent failure mode).
 * - With --critical: suggest for listed skills that are DROP or TRUNCATE.
 */
export function buildSuggestions(
  result: CompactionResult,
  critical: string[] = [],
): string[] {
  const criticalSet = new Set(critical);
  const suggestions: string[] = [];

  for (const skill of result.skills) {
    if (skill.status === "KEEP") continue;

    if (criticalSet.size > 0) {
      if (!criticalSet.has(skill.name)) continue;
    } else if (skill.status !== "DROP") {
      continue;
    }

    if (skill.status === "DROP") {
      suggestions.push(
        `Re-invoke /${skill.name} before compaction to save it (currently DROP).`,
      );
    } else if (skill.status === "TRUNCATE") {
      suggestions.push(
        `Re-invoke /${skill.name} before compaction to restore full content (currently TRUNCATE at ${skill.keptTokens}/${skill.tokens} tokens).`,
      );
    }
  }

  return suggestions;
}
