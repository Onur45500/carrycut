import type { SkillInput, StaleEntry } from "../core/types.js";

/**
 * Detect stale re-attach: SKILL.md on disk changed after the recorded invocation.
 * Without invocation timestamps (manual --invoked only), we cannot assert staleness
 * and return informative non-stale entries with a reason.
 */
export function detectStale(
  skills: SkillInput[],
  options?: { preferHash?: boolean },
): { entries: StaleEntry[]; warnings: string[] } {
  const warnings: string[] = [];
  const entries: StaleEntry[] = [];
  const preferHash = options?.preferHash ?? false;

  const anyTimestamps = skills.some((s) => Boolean(s.invokedAt));
  if (!anyTimestamps) {
    warnings.push(
      "No invocation timestamps available. Pass --session auto to compare file mtime against when the skill was last invoked. Showing current file metadata only.",
    );
  }

  for (const skill of skills) {
    if (!skill.path) {
      entries.push({
        name: skill.name,
        stale: false,
        reason: "SKILL.md not found on disk",
        invokedAt: skill.invokedAt,
      });
      continue;
    }

    if (!skill.invokedAt) {
      entries.push({
        name: skill.name,
        path: skill.path,
        stale: false,
        reason: "No invocation timestamp — cannot determine staleness",
        mtime: skill.mtime,
        contentHash: skill.contentHash,
      });
      continue;
    }

    if (!skill.mtime) {
      entries.push({
        name: skill.name,
        path: skill.path,
        stale: false,
        reason: "Missing file mtime",
        invokedAt: skill.invokedAt,
        contentHash: skill.contentHash,
      });
      continue;
    }

    const invokedMs = Date.parse(skill.invokedAt);
    const mtimeMs = Date.parse(skill.mtime);

    if (Number.isNaN(invokedMs) || Number.isNaN(mtimeMs)) {
      entries.push({
        name: skill.name,
        path: skill.path,
        stale: false,
        reason: "Unparseable timestamp",
        invokedAt: skill.invokedAt,
        mtime: skill.mtime,
        contentHash: skill.contentHash,
      });
      continue;
    }

    const fileNewer = mtimeMs > invokedMs;
    // Hash mode: we don't have a historical hash of what was loaded, so mtime
    // remains the primary signal; --hash adds the current hash to the report
    // for CI snapshotting / future comparison.
    const reason = fileNewer
      ? preferHash
        ? `File changed after invocation (mtime ${skill.mtime} > invoked ${skill.invokedAt}); current hash ${skill.contentHash?.slice(0, 12)}…`
        : `File mtime ${skill.mtime} is newer than invocation ${skill.invokedAt} — re-attached content may be stale vs disk`
      : preferHash
        ? `File unchanged since invocation; hash ${skill.contentHash?.slice(0, 12)}…`
        : "File mtime is not newer than last invocation";

    entries.push({
      name: skill.name,
      path: skill.path,
      stale: fileNewer,
      reason,
      invokedAt: skill.invokedAt,
      mtime: skill.mtime,
      contentHash: skill.contentHash,
    });
  }

  return { entries, warnings };
}
