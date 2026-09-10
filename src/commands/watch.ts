import type { SkillResult } from "../core/types.js";
import { runSim } from "./sim.js";
import type { SimCommandResult } from "./sim.js";
import type { SkillInput } from "../core/types.js";
import type { WatchJsonEvent } from "../core/types.js";

export interface WatchEvaluateOptions {
  skills: SkillInput[];
  critical?: string[];
  strict?: boolean;
  warnings?: string[];
  calibration: number;
  sessionPath?: string;
  lastCompactAt?: string;
  lastCompactTrigger?: string;
  lastCompactPreTokens?: number;
  /** Previous alert skill names (for edge triggering). */
  previousAlertKey?: string;
}

export interface WatchEvaluateResult {
  sim: SimCommandResult;
  alertSkills: string[];
  /** Stable key of current alert set for edge comparison. */
  alertKey: string;
  /** True when we should emit an alert (new or changed alert set). */
  shouldAlert: boolean;
  event: WatchJsonEvent;
  exitCode: number;
}

/**
 * Skills that warrant an alert:
 * - With --critical: those critical skills that DROP (or TRUNCATE if strict)
 * - Without --critical: any DROP (session-guardian default)
 */
export function computeAlertSkills(
  skills: SkillResult[],
  critical: string[],
  strict: boolean,
): string[] {
  const criticalSet = new Set(critical);
  const alerts: string[] = [];

  for (const skill of skills) {
    if (criticalSet.size > 0) {
      if (!criticalSet.has(skill.name)) continue;
      if (skill.status === "DROP") alerts.push(skill.name);
      else if (strict && skill.status === "TRUNCATE") alerts.push(skill.name);
    } else if (skill.status === "DROP") {
      alerts.push(skill.name);
    }
  }

  return alerts;
}

export function alertKeyFrom(skills: string[]): string {
  return [...skills].sort().join(",");
}

/**
 * Pure watch evaluation — no sleep / I/O. Used by the CLI loop and unit tests.
 */
export function evaluateWatch(
  options: WatchEvaluateOptions,
): WatchEvaluateResult {
  const critical = options.critical ?? [];
  const strict = Boolean(options.strict);

  const sim = runSim({
    skills: options.skills,
    critical,
    strict,
    warnings: options.warnings,
    calibration: options.calibration,
  });

  // For watch guardian mode without --critical, still surface DROP suggestions
  const alertSkills = computeAlertSkills(
    sim.result.skills,
    critical,
    strict,
  );
  const alertKey = alertKeyFrom(alertSkills);
  const shouldAlert =
    alertSkills.length > 0 && alertKey !== (options.previousAlertKey ?? "");

  // Suggestions: when no critical list, still suggest for DROP skills
  const suggestions =
    critical.length > 0
      ? sim.suggestions
      : sim.result.skills
          .filter((s) => s.status === "DROP")
          .map(
            (s) =>
              `Re-invoke /${s.name} before compaction to save it (currently DROP).`,
          );

  const event: WatchJsonEvent = {
    type: alertSkills.length > 0 ? "alert" : "ok",
    sessionPath: options.sessionPath,
    lastCompactAt: options.lastCompactAt,
    lastCompactTrigger: options.lastCompactTrigger,
    lastCompactPreTokens: options.lastCompactPreTokens,
    skills: sim.result.skills,
    suggestions,
    alertSkills,
    warnings: sim.warnings,
  };

  // --once exit: 1 if currently alerting, 2 if no skills, else 0
  let exitCode = 0;
  if (options.skills.length === 0) exitCode = 2;
  else if (alertSkills.length > 0) exitCode = 1;

  return {
    sim: { ...sim, suggestions },
    alertSkills,
    alertKey,
    shouldAlert,
    event,
    exitCode,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
