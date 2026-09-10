/** Per-skill token cap when re-attaching after compaction. */
export const SKILL_TOKEN_CAP = 5_000;

/** Combined budget for all re-attached skills. */
export const COMBINED_BUDGET = 25_000;

/** Default tiktoken → Claude calibration multiplier. */
export const DEFAULT_CALIBRATION = 1.15;

export type SkillStatus = "KEEP" | "TRUNCATE" | "DROP";

export interface SkillInput {
  name: string;
  /** Calibrated token count of rendered body (frontmatter stripped). */
  tokens: number;
  /**
   * Invocation position: higher = more recent.
   * When building from `--invoked a,b,c`, c has the highest position.
   */
  position: number;
  /** ISO timestamp of invocation when known (from transcript). */
  invokedAt?: string;
  /** True if SKILL.md contains dynamic context commands (`!`cmd``). */
  hasDynamicContext?: boolean;
  /** Absolute path to SKILL.md if resolved. */
  path?: string;
  /** File mtime ISO string. */
  mtime?: string;
  /** Content hash of raw file (sha256 hex). */
  contentHash?: string;
}

export interface SkillResult {
  name: string;
  status: SkillStatus;
  /** Original calibrated token count. */
  tokens: number;
  /** Tokens kept after per-skill cap and combined budget. */
  keptTokens: number;
  /** Per-skill cap used (always SKILL_TOKEN_CAP). */
  skillCap: number;
  hasDynamicContext: boolean;
  path?: string;
  invokedAt?: string;
  mtime?: string;
  contentHash?: string;
  /** Remaining combined budget after this skill was considered. */
  budgetRemaining: number;
}

export interface CompactionResult {
  skills: SkillResult[];
  combinedBudget: number;
  budgetUsed: number;
  budgetRemaining: number;
}

export interface StaleEntry {
  name: string;
  path?: string;
  stale: boolean;
  reason: string;
  invokedAt?: string;
  mtime?: string;
  contentHash?: string;
}

export interface SimJsonOutput {
  ok: boolean;
  calibration: number;
  combinedBudget: number;
  budgetUsed: number;
  budgetRemaining: number;
  skills: SkillResult[];
  suggestions: string[];
  warnings: string[];
  sessionPath?: string;
  lastCompactAt?: string;
  lastCompactTrigger?: string;
  lastCompactPreTokens?: number;
}

export type WatchEventType = "ok" | "alert";

export interface WatchJsonEvent {
  type: WatchEventType;
  sessionPath?: string;
  lastCompactAt?: string;
  lastCompactTrigger?: string;
  lastCompactPreTokens?: number;
  skills: SkillResult[];
  suggestions: string[];
  alertSkills: string[];
  warnings: string[];
}

export interface StaleJsonOutput {
  ok: boolean;
  entries: StaleEntry[];
  warnings: string[];
}
