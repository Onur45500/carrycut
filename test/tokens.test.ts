import { describe, expect, it } from "vitest";
import { countTokens, countTokensRaw } from "../src/core/tokens.js";
import { stripFrontmatter, hasDynamicContext } from "../src/input/skills.js";

describe("countTokens", () => {
  it("returns 0 for empty string", () => {
    expect(countTokens("")).toBe(0);
    expect(countTokensRaw("")).toBe(0);
  });

  it("applies calibration multiplier (rounded up)", () => {
    const text = "hello world, this is a short skill body";
    const raw = countTokensRaw(text);
    const calibrated = countTokens(text, 1.15);
    expect(calibrated).toBe(Math.ceil(raw * 1.15));
    expect(calibrated).toBeGreaterThanOrEqual(raw);
  });

  it("calibration 1.0 matches raw", () => {
    const text = "abcdefghijklmnopqrstuvwxyz";
    expect(countTokens(text, 1)).toBe(countTokensRaw(text));
  });
});

describe("stripFrontmatter", () => {
  it("strips YAML frontmatter from skill body", () => {
    const content = `---
name: demo
description: A demo skill
---
# Body

Do the thing.
`;
    const body = stripFrontmatter(content);
    expect(body).not.toContain("name: demo");
    expect(body).toContain("# Body");
    expect(body).toContain("Do the thing.");
  });

  it("returns content unchanged when no frontmatter", () => {
    const content = "# Just a body\n";
    expect(stripFrontmatter(content)).toBe(content);
  });

  it("excludes frontmatter from token counts", () => {
    const frontmatter = `---
name: x
description: ${"word ".repeat(500)}
---
`;
    const body = "Short body.";
    const withFm = frontmatter + body;
    const tokensBody = countTokens(stripFrontmatter(withFm), 1);
    const tokensRawFile = countTokens(withFm, 1);
    expect(tokensBody).toBeLessThan(tokensRawFile);
    expect(tokensBody).toBe(countTokens(body, 1));
  });
});

describe("hasDynamicContext", () => {
  it("detects !`cmd` dynamic context markers", () => {
    expect(hasDynamicContext("See !`git status` for context")).toBe(true);
    expect(hasDynamicContext("No dynamic here")).toBe(false);
  });
});
