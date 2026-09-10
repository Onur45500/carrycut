import { describe, expect, it } from "vitest";
import {
  buildSuggestions,
  dedupeNewest,
  simulateCompaction,
} from "../src/core/engine.js";
import type { SkillInput } from "../src/core/types.js";

function skill(
  name: string,
  tokens: number,
  position: number,
): SkillInput {
  return { name, tokens, position };
}

describe("dedupeNewest", () => {
  it("keeps only the most recent invocation per skill", () => {
    const result = dedupeNewest([
      skill("auth", 100, 0),
      skill("pdf", 200, 1),
      skill("auth", 999, 2),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe("auth");
    expect(result[0]?.tokens).toBe(999);
    expect(result[0]?.position).toBe(2);
    expect(result[1]?.name).toBe("pdf");
  });

  it("does not double-count identical names", () => {
    const sim = simulateCompaction([
      skill("auth", 3000, 0),
      skill("auth", 3000, 1),
    ]);
    expect(sim.skills).toHaveLength(1);
    expect(sim.budgetUsed).toBe(3000);
  });
});

describe("simulateCompaction", () => {
  it("returns empty result for empty input", () => {
    const sim = simulateCompaction([]);
    expect(sim.skills).toEqual([]);
    expect(sim.budgetUsed).toBe(0);
    expect(sim.budgetRemaining).toBe(25_000);
  });

  it("KEEPs two skills that fit entirely", () => {
    const sim = simulateCompaction([
      skill("a", 1000, 0),
      skill("b", 2000, 1),
    ]);
    expect(sim.skills.map((s) => s.status)).toEqual(["KEEP", "KEEP"]);
    expect(sim.budgetUsed).toBe(3000);
  });

  it("TRUNCATEs a skill over the 5000 per-skill cap", () => {
    const sim = simulateCompaction([skill("giant", 12_000, 0)]);
    expect(sim.skills[0]?.status).toBe("TRUNCATE");
    expect(sim.skills[0]?.keptTokens).toBe(5_000);
    expect(sim.budgetUsed).toBe(5_000);
  });

  it("KEEPs a skill exactly at 5000", () => {
    const sim = simulateCompaction([skill("exact", 5_000, 0)]);
    expect(sim.skills[0]?.status).toBe("KEEP");
    expect(sim.skills[0]?.keptTokens).toBe(5_000);
  });

  it("DROPs older skills when 6 large skills exhaust the 25k budget", () => {
    // Newest-first: 5 × 5000 = 25000; the oldest (6th) DROPs
    const skills = [
      skill("oldest", 5_000, 0),
      skill("s2", 5_000, 1),
      skill("s3", 5_000, 2),
      skill("s4", 5_000, 3),
      skill("s5", 5_000, 4),
      skill("newest", 5_000, 5),
    ];
    const sim = simulateCompaction(skills);
    const byName = Object.fromEntries(sim.skills.map((s) => [s.name, s]));
    expect(byName.newest?.status).toBe("KEEP");
    expect(byName.s5?.status).toBe("KEEP");
    expect(byName.s4?.status).toBe("KEEP");
    expect(byName.s3?.status).toBe("KEEP");
    expect(byName.s2?.status).toBe("KEEP");
    expect(byName.oldest?.status).toBe("DROP");
    expect(byName.oldest?.keptTokens).toBe(0);
    expect(sim.budgetUsed).toBe(25_000);
    expect(sim.budgetRemaining).toBe(0);
  });

  it("TRUNCATEs when remaining combined budget is less than the capped size", () => {
    // Newest takes 24_000? Cap is 5k so need a different setup:
    // Use custom budgets for this edge case via options — or craft with remaining.
    // Three skills: newest 5000, mid 5000, oldest 5000 with combined budget...
    // Actually under default 25k, need remaining < capped.
    // Skill A (newest) 5000, B 5000, C 5000, D 5000, E would need 5000 but only 5000 left → KEEP
    // For TRUNCATE by combined budget: use options
    const sim = simulateCompaction(
      [skill("old", 4_000, 0), skill("new", 3_000, 1)],
      { combinedBudget: 5_000, skillCap: 5_000 },
    );
    const byName = Object.fromEntries(sim.skills.map((s) => [s.name, s]));
    expect(byName.new?.status).toBe("KEEP");
    expect(byName.new?.keptTokens).toBe(3_000);
    expect(byName.old?.status).toBe("TRUNCATE");
    expect(byName.old?.keptTokens).toBe(2_000);
  });

  it("a near-max skill starves older ones", () => {
    // Six skills: giant truncates to 5k; five more at 5k → oldest DROPs
    const sim = simulateCompaction([
      skill("important", 4_800, 0),
      skill("b", 5_000, 1),
      skill("c", 5_000, 2),
      skill("d", 5_000, 3),
      skill("e", 5_000, 4),
      skill("hoarder", 50_000, 5),
    ]);
    const byName = Object.fromEntries(sim.skills.map((s) => [s.name, s]));
    expect(byName.hoarder?.status).toBe("TRUNCATE");
    expect(byName.hoarder?.keptTokens).toBe(5_000);
    expect(byName.important?.status).toBe("DROP");
    expect(sim.budgetUsed).toBe(25_000);
  });

  it("presents results in oldest→newest invocation order", () => {
    const sim = simulateCompaction([
      skill("first", 100, 0),
      skill("second", 100, 1),
      skill("third", 100, 2),
    ]);
    expect(sim.skills.map((s) => s.name)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });
});

describe("buildSuggestions", () => {
  it("suggests re-invoke for DROP skills", () => {
    const sim = simulateCompaction([
      skill("auth-helper", 5_000, 0),
      skill("a", 5_000, 1),
      skill("b", 5_000, 2),
      skill("c", 5_000, 3),
      skill("d", 5_000, 4),
      skill("e", 5_000, 5),
    ]);
    const suggestions = buildSuggestions(sim, ["auth-helper"]);
    expect(suggestions.some((s) => s.includes("/auth-helper"))).toBe(true);
    expect(suggestions.some((s) => s.includes("DROP"))).toBe(true);
  });

  it("limits suggestions to --critical list when provided", () => {
    const sim = simulateCompaction([
      skill("old", 5_000, 0),
      skill("a", 5_000, 1),
      skill("b", 5_000, 2),
      skill("c", 5_000, 3),
      skill("d", 5_000, 4),
      skill("e", 5_000, 5),
    ]);
    const suggestions = buildSuggestions(sim, ["a"]);
    // "old" is DROP but not critical; "a" is KEEP — so no suggestions
    expect(suggestions).toHaveLength(0);
  });
});
