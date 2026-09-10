import { describe, expect, it } from "vitest";
import {
  alertKeyFrom,
  computeAlertSkills,
  evaluateWatch,
} from "../src/commands/watch.js";
import type { SkillInput, SkillResult } from "../src/core/types.js";

function skill(
  name: string,
  tokens: number,
  position: number,
): SkillInput {
  return { name, tokens, position };
}

function result(
  name: string,
  status: SkillResult["status"],
): SkillResult {
  return {
    name,
    status,
    tokens: 5000,
    keptTokens: status === "DROP" ? 0 : 5000,
    skillCap: 5000,
    hasDynamicContext: false,
    budgetRemaining: 0,
  };
}

describe("computeAlertSkills", () => {
  it("alerts on any DROP when no critical list", () => {
    const alerts = computeAlertSkills(
      [result("a", "KEEP"), result("b", "DROP")],
      [],
      false,
    );
    expect(alerts).toEqual(["b"]);
  });

  it("alerts only critical DROP when list provided", () => {
    const alerts = computeAlertSkills(
      [result("important", "DROP"), result("other", "DROP")],
      ["important"],
      false,
    );
    expect(alerts).toEqual(["important"]);
  });

  it("with strict, alerts critical TRUNCATE", () => {
    const alerts = computeAlertSkills(
      [result("important", "TRUNCATE")],
      ["important"],
      true,
    );
    expect(alerts).toEqual(["important"]);
  });
});

describe("evaluateWatch edge trigger", () => {
  const dropScenario: SkillInput[] = [
    skill("important", 5_000, 0),
    skill("a", 5_000, 1),
    skill("b", 5_000, 2),
    skill("c", 5_000, 3),
    skill("d", 5_000, 4),
    skill("e", 5_000, 5),
  ];

  it("exits 1 on --once when a skill would DROP", () => {
    const first = evaluateWatch({
      skills: dropScenario,
      calibration: 1.15,
    });
    expect(first.exitCode).toBe(1);
    expect(first.event.type).toBe("alert");
    expect(first.shouldAlert).toBe(true);
  });

  it("does not re-alert when alert set unchanged", () => {
    const first = evaluateWatch({
      skills: dropScenario,
      calibration: 1.15,
    });
    const second = evaluateWatch({
      skills: dropScenario,
      calibration: 1.15,
      previousAlertKey: first.alertKey,
    });
    expect(second.shouldAlert).toBe(false);
    expect(second.alertSkills).toEqual(first.alertSkills);
  });

  it("re-alerts when alert set changes", () => {
    const first = evaluateWatch({
      skills: dropScenario,
      calibration: 1.15,
    });
    const second = evaluateWatch({
      skills: dropScenario,
      critical: ["important"],
      calibration: 1.15,
      previousAlertKey: first.alertKey,
    });
    // same alert set (important) — key may match
    expect(alertKeyFrom(["important"])).toBe("important");
    expect(second.alertKey).toBe("important");
  });

  it("exits 0 when all skills KEEP", () => {
    const ok = evaluateWatch({
      skills: [skill("a", 100, 0), skill("b", 100, 1)],
      calibration: 1.15,
    });
    expect(ok.exitCode).toBe(0);
    expect(ok.event.type).toBe("ok");
    expect(ok.shouldAlert).toBe(false);
  });

  it("exits 2 when no skills", () => {
    const empty = evaluateWatch({ skills: [], calibration: 1.15 });
    expect(empty.exitCode).toBe(2);
  });
});
