import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  detectCompactEvent,
  encodeProjectPathVariants,
  extractSkillNamesFromRecord,
  findLatestSession,
  parseTranscriptFile,
} from "../src/input/transcript.js";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

describe("extractSkillNamesFromRecord V2", () => {
  it("extracts slash commands from array text content blocks", () => {
    const names = extractSkillNamesFromRecord({
      message: {
        role: "user",
        content: [
          { type: "text", text: "run /auth-helper now" },
        ],
      },
    });
    expect(names).toContain("auth-helper");
  });

  it("extracts nested input.args.skill", () => {
    const names = extractSkillNamesFromRecord({
      message: {
        content: [
          {
            type: "tool_use",
            name: "Skill",
            input: { args: { skill: "deploy-guard" } },
          },
        ],
      },
    });
    expect(names).toContain("deploy-guard");
  });

  it("ignores /login /logout /vim /diff /export", () => {
    const names = extractSkillNamesFromRecord({
      message: { content: "/login /logout /vim /diff /export /my-skill" },
    });
    expect(names).toEqual(["my-skill"]);
  });
});

describe("detectCompactEvent", () => {
  it("detects official compact_boundary + compactMetadata.trigger", () => {
    expect(
      detectCompactEvent({
        type: "system",
        subtype: "compact_boundary",
        timestamp: "2026-01-01T00:00:00.000Z",
        compactMetadata: { trigger: "manual", preTokens: 120000 },
      }),
    ).toEqual({
      compacted: true,
      at: "2026-01-01T00:00:00.000Z",
      kind: "compact_boundary",
      trigger: "manual",
      preTokens: 120000,
    });
  });

  it("detects isCompactSummary user messages", () => {
    const result = detectCompactEvent({
      type: "user",
      isCompactSummary: true,
      timestamp: "2026-01-01T00:00:01.000Z",
      message: { content: "summary text" },
    });
    expect(result.compacted).toBe(true);
    expect(result.kind).toBe("compact_summary");
  });

  it("detects /compact in user text (legacy)", () => {
    expect(
      detectCompactEvent({
        message: { content: "please /compact now" },
      }).compacted,
    ).toBe(true);
  });

  it("detects conversation_compacted type (legacy)", () => {
    const result = detectCompactEvent({
      type: "conversation_compacted",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    expect(result.compacted).toBe(true);
    expect(result.at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns false for normal chat", () => {
    expect(
      detectCompactEvent({ message: { content: "hello" } }).compacted,
    ).toBe(false);
  });
});

describe("encodeProjectPathVariants", () => {
  it("includes Windows drive-letter encodings", () => {
    const variants = encodeProjectPathVariants("G:\\DEV\\carrycut");
    expect(variants.some((v) => v.includes("DEV") && v.includes("carrycut"))).toBe(
      true,
    );
    expect(variants.some((v) => /^[-]?[Gg]-/.test(v))).toBe(true);
  });
});

describe("parseTranscriptFile fixtures", () => {
  it("parses array-content fixture with compaction marker", () => {
    const file = join(fixturesDir, "session-array-content.jsonl");
    const parsed = parseTranscriptFile(file);
    expect(parsed.invokedNames).toEqual([
      "auth-helper",
      "pdf-tools",
      "git-flow",
      "deploy-guard",
    ]);
    expect(parsed.lastCompactAt).toBe("2026-03-01T09:02:01.000Z");
    expect(parsed.lastCompactTrigger).toBe("auto");
    expect(parsed.lastCompactPreTokens).toBe(182400);
    expect(parsed.invokedNames).not.toContain("fake-skill");
    expect(
      parsed.warnings.some((w) => /trigger: auto/i.test(w)),
    ).toBe(true);
  });

  it("does not mine skills from isCompactSummary content", () => {
    expect(
      extractSkillNamesFromRecord({
        type: "user",
        isCompactSummary: true,
        message: { content: "mentions /auth-helper and /deploy-guard" },
      }),
    ).toEqual([]);
  });
});

describe("findLatestSession Windows-style project dir", () => {
  it("finds jsonl under an encoded Windows project path", () => {
    const home = mkdtempSync(join(tmpdir(), "carrycut-win-"));
    const cwd = "G:\\DEV\\carrycut";
    const variants = encodeProjectPathVariants(cwd);
    const projectDir = join(home, ".claude", "projects", variants[0]!);
    mkdirSync(projectDir, { recursive: true });
    const session = join(projectDir, "sess.jsonl");
    writeFileSync(
      session,
      JSON.stringify({
        type: "user",
        timestamp: "2026-01-01T00:00:00.000Z",
        message: { content: "/auth-helper" },
      }) + "\n",
      "utf8",
    );

    const result = findLatestSession({ home, cwd, session: "auto" });
    expect(result.path).toBe(session);
  });
});
