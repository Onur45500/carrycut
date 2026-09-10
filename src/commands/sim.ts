import {
  buildSuggestions,
  simulateCompaction,
} from "../core/engine.js";
import type { CompactionResult, SimJsonOutput } from "../core/types.js";
import type { SkillInput } from "../core/types.js";

export interface SimOptions {
  skills: SkillInput[];
  critical?: string[];
  strict?: boolean;
  warnings?: string[];
  calibration: number;
}

export interface SimCommandResult {
  result: CompactionResult;
  suggestions: string[];
  warnings: string[];
  /** Exit code: 0 clean, 1 critical failure, 2 usage. */
  exitCode: number;
  json: SimJsonOutput;
}

export function runSim(options: SimOptions): SimCommandResult {
  const warnings = [...(options.warnings ?? [])];
  const critical = options.critical ?? [];

  if (options.skills.length === 0) {
    const json: SimJsonOutput = {
      ok: false,
      calibration: options.calibration,
      combinedBudget: 25_000,
      budgetUsed: 0,
      budgetRemaining: 25_000,
      skills: [],
      suggestions: [],
      warnings,
    };
    return {
      result: {
        skills: [],
        combinedBudget: 25_000,
        budgetUsed: 0,
        budgetRemaining: 25_000,
      },
      suggestions: [],
      warnings,
      exitCode: 2,
      json,
    };
  }

  const result = simulateCompaction(options.skills);
  const suggestions = buildSuggestions(result, critical);

  let exitCode = 0;
  const criticalSet = new Set(critical);
  for (const skill of result.skills) {
    if (criticalSet.size > 0 && !criticalSet.has(skill.name)) continue;
    if (skill.status === "DROP") {
      exitCode = 1;
      break;
    }
    if (options.strict && skill.status === "TRUNCATE") {
      exitCode = 1;
      break;
    }
  }

  // If no --critical given, still exit 1 only when explicitly requested via critical list.
  // Plan: "exit 1 if a critical skill listed in --critical would be DROP"
  if (criticalSet.size === 0) {
    exitCode = 0;
  }

  const json: SimJsonOutput = {
    ok: exitCode === 0,
    calibration: options.calibration,
    combinedBudget: result.combinedBudget,
    budgetUsed: result.budgetUsed,
    budgetRemaining: result.budgetRemaining,
    skills: result.skills,
    suggestions,
    warnings,
  };

  return { result, suggestions, warnings, exitCode, json };
}
