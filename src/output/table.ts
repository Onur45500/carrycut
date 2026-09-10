import pc from "picocolors";
import type { CompactionResult, SkillResult } from "../core/types.js";

function pad(str: string, width: number): string {
  if (str.length >= width) return str;
  return str + " ".repeat(width - str.length);
}

function statusColor(status: SkillResult["status"], text: string): string {
  switch (status) {
    case "KEEP":
      return pc.green(text);
    case "TRUNCATE":
      return pc.yellow(text);
    case "DROP":
      return pc.red(text);
  }
}

/**
 * ASCII token bar against the per-skill 5000 cap.
 * Example: [████████░░] 4200/5000
 */
export function tokenBar(kept: number, cap: number, width = 10): string {
  const ratio = cap <= 0 ? 0 : Math.min(1, kept / cap);
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  return `[${bar}] ${kept}/${cap}`;
}

export function formatTable(
  result: CompactionResult,
  options?: {
    suggestions?: string[];
    warnings?: string[];
    title?: string;
    sessionPath?: string;
    sessionSkillCount?: number;
    lastCompactAt?: string;
  },
): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(
    pc.bold(options?.title ?? "carrycut sim — compaction survival forecast"),
  );
  if (options?.sessionPath) {
    const count =
      options.sessionSkillCount != null
        ? ` · ${options.sessionSkillCount} skill(s)`
        : "";
    lines.push(pc.dim(`Session: ${options.sessionPath}${count}`));
  }
  if (options?.lastCompactAt) {
    lines.push(pc.dim(`Last compaction: ${options.lastCompactAt}`));
  }
  lines.push(
    pc.dim(
      `Budget: ${result.budgetUsed}/${result.combinedBudget} tokens used · ${result.budgetRemaining} remaining`,
    ),
  );
  lines.push("");

  const nameW = Math.max(
    12,
    ...result.skills.map(
      (s) => s.name.length + (s.hasDynamicContext ? 10 : 0),
    ),
  );

  const header =
    pad("SKILL", nameW) +
    "  " +
    pad("STATUS", 8) +
    "  " +
    pad("TOKENS", 14) +
    "  BAR";
  lines.push(pc.dim(header));
  lines.push(pc.dim("-".repeat(Math.max(60, header.length))));

  for (const skill of result.skills) {
    const plainName =
      skill.name + (skill.hasDynamicContext ? " ~DYNAMIC" : "");
    const namePad = " ".repeat(Math.max(0, nameW - plainName.length));
    const nameCol =
      skill.name +
      (skill.hasDynamicContext ? pc.dim(" ~DYNAMIC") : "") +
      namePad;
    const status = statusColor(skill.status, pad(skill.status, 8));
    const tokens = pad(`${skill.keptTokens}/${skill.tokens}`, 14);
    const bar = tokenBar(skill.keptTokens, skill.skillCap);
    const coloredBar =
      skill.status === "DROP"
        ? pc.red(bar)
        : skill.status === "TRUNCATE"
          ? pc.yellow(bar)
          : pc.green(bar);

    lines.push(`${nameCol}  ${status}  ${tokens}  ${coloredBar}`);
  }

  if (options?.warnings?.length) {
    lines.push("");
    lines.push(pc.yellow("Warnings:"));
    for (const w of options.warnings) {
      lines.push(pc.yellow(`  • ${w}`));
    }
  }

  if (options?.suggestions?.length) {
    lines.push("");
    lines.push(pc.cyan("Suggestions:"));
    for (const s of options.suggestions) {
      lines.push(pc.cyan(`  → ${s}`));
    }
  }

  lines.push("");
  return lines.join("\n");
}
