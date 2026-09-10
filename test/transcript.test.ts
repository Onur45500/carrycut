import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractSkillNamesFromRecord,
  findLatestSession,
  parseTranscriptFile,
} from "../src/input/transcript.js";

describe("extractSkillNamesFromRecord", () => {
  it("extracts skill tool_use input.skill", () => {
    const names = extractSkillNamesFromRecord({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Skill",
            input: { skill: "auth-helper" },
          },
        ],
      },
    });
    expect(names).toContain("auth-helper");
  });

  it("extracts /slash commands from user text", () => {
    const names = extractSkillNamesFromRecord({
      message: {
        role: "user",
        content: "Please run /deploy-guard and then continue",
      },
    });
    expect(names).toContain("deploy-guard");
  });

  it("ignores built-in /compact", () => {
    const names = extractSkillNamesFromRecord({
      message: { content: "/compact please" },
    });
    expect(names).not.toContain("compact");
  });
});

describe("parseTranscriptFile", () => {
  it("parses a valid fixture and orders oldest→newest", () => {
    const dir = mkdtempSync(join(tmpdir(), "carrycut-"));
    const file = join(dir, "session.jsonl");
    const lines = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-01-01T10:00:00.000Z",
        message: { content: "/auth-helper" },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-01-01T10:01:00.000Z",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Skill",
              input: { skill: "pdf-tools" },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        timestamp: "2026-01-01T10:02:00.000Z",
        message: { content: "invoke /git-flow now" },
      }),
      "this is not json",
      JSON.stringify({
        type: "user",
        timestamp: "2026-01-01T10:03:00.000Z",
        message: { content: "/auth-helper again with args" },
      }),
    ];
    writeFileSync(file, lines.join("\n"), "utf8");

    const parsed = parseTranscriptFile(file);
    // auth-helper appears twice; last occurrence wins → newest among unique set
    expect(parsed.invokedNames).toEqual([
      "pdf-tools",
      "git-flow",
      "auth-helper",
    ]);
    expect(parsed.warnings).toEqual([]);
  });

  it("warns on empty / missing skill hits", () => {
    const dir = mkdtempSync(join(tmpdir(), "carrycut-"));
    const file = join(dir, "empty.jsonl");
    writeFileSync(
      file,
      JSON.stringify({ type: "user", message: { content: "hello" } }) + "\n",
      "utf8",
    );
    const parsed = parseTranscriptFile(file);
    expect(parsed.invokedNames).toEqual([]);
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });

  it("warns when file is missing", () => {
    const parsed = parseTranscriptFile(
      join(tmpdir(), "carrycut-does-not-exist.jsonl"),
    );
    expect(parsed.invokedNames).toEqual([]);
    expect(parsed.warnings[0]).toMatch(/not found/i);
  });

  it("survives a file with only malformed lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "carrycut-"));
    const file = join(dir, "bad.jsonl");
    writeFileSync(file, "{not json\n!!!\n", "utf8");
    const parsed = parseTranscriptFile(file);
    expect(parsed.invokedNames).toEqual([]);
    expect(parsed.warnings.some((w) => /no valid JSONL/i.test(w))).toBe(true);
  });
});

describe("findLatestSession", () => {
  it("returns warning when projects dir is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "carrycut-home-"));
    const result = findLatestSession({ home: dir, cwd: "/tmp/proj" });
    expect(result.path).toBeUndefined();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("picks the newest jsonl in an explicit directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "carrycut-sess-"));
    const older = join(dir, "old.jsonl");
    const newer = join(dir, "new.jsonl");
    writeFileSync(older, "{}\n", "utf8");
    writeFileSync(newer, "{}\n", "utf8");
    utimesSync(older, new Date(1_000_000), new Date(1_000_000));
    utimesSync(newer, new Date(2_000_000_000), new Date(2_000_000_000));

    const result = findLatestSession({ session: dir });
    expect(result.path).toBe(newer);
  });

  it("accepts an explicit jsonl file path", () => {
    const dir = mkdtempSync(join(tmpdir(), "carrycut-file-"));
    const file = join(dir, "s.jsonl");
    writeFileSync(file, "{}\n", "utf8");
    const result = findLatestSession({ session: file });
    expect(result.path).toBe(file);
  });
});
