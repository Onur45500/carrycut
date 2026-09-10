import { describe, expect, it } from "vitest";
import { detectStale } from "../src/commands/stale.js";
import { runSim } from "../src/commands/sim.js";
import type { SkillInput } from "../src/core/types.js";

describe("detectStale", () => {
  it("flags file newer than invocation as stale", () => {
    const skills: SkillInput[] = [
      {
        name: "auth-helper",
        tokens: 100,
        position: 0,
        path: "/tmp/SKILL.md",
        invokedAt: "2026-01-01T00:00:00.000Z",
        mtime: "2026-06-01T00:00:00.000Z",
        contentHash: "abc",
      },
    ];
    const { entries } = detectStale(skills);
    expect(entries[0]?.stale).toBe(true);
  });

  it("is not stale when mtime is older than invocation", () => {
    const skills: SkillInput[] = [
      {
        name: "auth-helper",
        tokens: 100,
        position: 0,
        path: "/tmp/SKILL.md",
        invokedAt: "2026-06-01T00:00:00.000Z",
        mtime: "2026-01-01T00:00:00.000Z",
        contentHash: "abc",
      },
    ];
    const { entries } = detectStale(skills);
    expect(entries[0]?.stale).toBe(false);
  });

  it("warns when no timestamps are available", () => {
    const { entries, warnings } = detectStale([
      { name: "x", tokens: 1, position: 0, path: "/tmp/x", mtime: "2026-01-01T00:00:00.000Z" },
    ]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(entries[0]?.stale).toBe(false);
  });
});

describe("runSim exit codes", () => {
  it("exits 1 when a --critical skill would DROP", () => {
    const skills: SkillInput[] = [
      { name: "important", tokens: 5_000, position: 0 },
      { name: "a", tokens: 5_000, position: 1 },
      { name: "b", tokens: 5_000, position: 2 },
      { name: "c", tokens: 5_000, position: 3 },
      { name: "d", tokens: 5_000, position: 4 },
      { name: "e", tokens: 5_000, position: 5 },
    ];
    const result = runSim({
      skills,
      critical: ["important"],
      calibration: 1.15,
    });
    expect(result.exitCode).toBe(1);
    expect(result.json.ok).toBe(false);
  });

  it("exits 0 without --critical even if skills DROP", () => {
    const skills: SkillInput[] = [
      { name: "important", tokens: 5_000, position: 0 },
      { name: "a", tokens: 5_000, position: 1 },
      { name: "b", tokens: 5_000, position: 2 },
      { name: "c", tokens: 5_000, position: 3 },
      { name: "d", tokens: 5_000, position: 4 },
      { name: "e", tokens: 5_000, position: 5 },
    ];
    const result = runSim({ skills, calibration: 1.15 });
    expect(result.exitCode).toBe(0);
  });

  it("exits 2 on empty skills", () => {
    const result = runSim({ skills: [], calibration: 1.15, warnings: ["none"] });
    expect(result.exitCode).toBe(2);
  });
});
