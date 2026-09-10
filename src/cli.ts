#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { DEFAULT_CALIBRATION } from "./core/types.js";
import { runSim } from "./commands/sim.js";
import { detectStale } from "./commands/stale.js";
import { evaluateWatch, sleep } from "./commands/watch.js";
import { resolveInvocationSource } from "./input/resolve.js";
import { parseInvokedList } from "./input/skills.js";
import { printJson } from "./output/json.js";
import { formatTable } from "./output/table.js";
import type { StaleJsonOutput } from "./core/types.js";

const VERSION = "2.0.0";

const program = new Command();

program
  .name("carrycut")
  .description(
    "Session guardian: simulate which Claude Code skills survive auto-compaction",
  )
  .version(VERSION);

program
  .command("sim")
  .description(
    "Simulate compaction re-attachment: KEEP / TRUNCATE / DROP per skill",
  )
  .option(
    "--invoked <list>",
    "Comma-separated skill names; last = most recently invoked",
  )
  .option(
    "--session <path>",
    'Session JSONL path, or "auto" to find the latest Claude Code transcript',
  )
  .option(
    "--critical <list>",
    "Comma-separated skills that must not DROP (exit 1 if they would)",
  )
  .option(
    "--strict",
    "With --critical, also fail on TRUNCATE (default: DROP only)",
  )
  .option("--json", "Machine-readable JSON output")
  .option(
    "--calibration <factor>",
    "tiktoken→Claude calibration multiplier",
    String(DEFAULT_CALIBRATION),
  )
  .option(
    "--skills-root <dir>",
    "Extra directory of <name>/SKILL.md trees (e.g. demo/skills)",
  )
  .action((opts: {
    invoked?: string;
    session?: string;
    critical?: string;
    strict?: boolean;
    json?: boolean;
    calibration?: string;
    skillsRoot?: string;
  }) => {
    if (!opts.invoked && !opts.session) {
      console.error(
        pc.red(
          "Error: provide --invoked skillA,skillB or --session auto|<path>",
        ),
      );
      process.exit(2);
    }

    const calibration = Number(opts.calibration);
    if (!Number.isFinite(calibration) || calibration <= 0) {
      console.error(pc.red("Error: --calibration must be a positive number"));
      process.exit(2);
    }

    const source = resolveInvocationSource({
      invoked: opts.invoked,
      session: opts.session,
      calibration,
      skillsRoot: opts.skillsRoot,
    });

    if (source.skills.length === 0) {
      if (opts.json) {
        printJson({
          ok: false,
          calibration,
          combinedBudget: 25_000,
          budgetUsed: 0,
          budgetRemaining: 25_000,
          skills: [],
          suggestions: [],
          warnings: source.warnings,
          sessionPath: source.sessionPath,
          lastCompactAt: source.lastCompactAt,
        });
      } else {
        for (const w of source.warnings) console.error(pc.yellow(w));
        console.error(pc.red("No skills to simulate."));
      }
      process.exit(2);
    }

    const critical = opts.critical ? parseInvokedList(opts.critical) : [];
    const sim = runSim({
      skills: source.skills,
      critical,
      strict: Boolean(opts.strict),
      warnings: source.warnings,
      calibration,
    });

    if (opts.json) {
      printJson({
        ...sim.json,
        sessionPath: source.sessionPath,
        lastCompactAt: source.lastCompactAt,
      });
    } else {
      process.stdout.write(
        formatTable(sim.result, {
          suggestions: sim.suggestions,
          warnings: sim.warnings,
          sessionPath: source.sessionPath,
          sessionSkillCount: source.sessionSkillCount ?? source.skills.length,
          lastCompactAt: source.lastCompactAt,
        }),
      );
    }

    process.exit(sim.exitCode);
  });

program
  .command("watch")
  .description(
    "Watch the active session and warn when compaction would DROP skills",
  )
  .option(
    "--session <path>",
    'Session JSONL path, or "auto" to find the latest transcript (default: auto if --invoked omitted)',
  )
  .option(
    "--invoked <list>",
    "Optional override list; otherwise skills come from the session",
  )
  .option(
    "--critical <list>",
    "Skills that must not DROP; without this, any DROP alerts",
  )
  .option(
    "--strict",
    "With --critical, also alert on TRUNCATE",
  )
  .option(
    "--interval <seconds>",
    "Poll interval in seconds (default: 5)",
    "5",
  )
  .option("--once", "Single check then exit (CI / hooks)")
  .option("--json", "NDJSON events: { type: ok|alert, ... }")
  .option(
    "--calibration <factor>",
    "tiktoken→Claude calibration multiplier",
    String(DEFAULT_CALIBRATION),
  )
  .option(
    "--skills-root <dir>",
    "Extra directory of <name>/SKILL.md trees",
  )
  .action(async (opts: {
    session?: string;
    invoked?: string;
    critical?: string;
    strict?: boolean;
    interval?: string;
    once?: boolean;
    json?: boolean;
    calibration?: string;
    skillsRoot?: string;
  }) => {
    const calibration = Number(opts.calibration);
    if (!Number.isFinite(calibration) || calibration <= 0) {
      console.error(pc.red("Error: --calibration must be a positive number"));
      process.exit(2);
    }

    const intervalSec = Number(opts.interval);
    if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
      console.error(pc.red("Error: --interval must be a positive number"));
      process.exit(2);
    }

    const critical = opts.critical ? parseInvokedList(opts.critical) : [];
    const session =
      opts.session ?? (opts.invoked ? undefined : "auto");
    if (!session && !opts.invoked) {
      console.error(
        pc.red(
          "Error: provide --session auto|<path> and/or --invoked skillA,skillB",
        ),
      );
      process.exit(2);
    }

    let previousAlertKey = "";
    let firstTick = true;
    let stop = false;

    const onSignal = () => {
      stop = true;
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    const runTick = (): number => {
      const source = resolveInvocationSource({
        invoked: opts.invoked,
        session,
        calibration,
        skillsRoot: opts.skillsRoot,
      });

      const evaluated = evaluateWatch({
        skills: source.skills,
        critical,
        strict: Boolean(opts.strict),
        warnings: source.warnings,
        calibration,
        sessionPath: source.sessionPath,
        lastCompactAt: source.lastCompactAt,
        previousAlertKey,
      });

      const cleared =
        previousAlertKey !== "" && evaluated.alertSkills.length === 0;
      const emit =
        Boolean(opts.once) ||
        firstTick ||
        evaluated.shouldAlert ||
        cleared;

      if (opts.json) {
        if (emit) {
          process.stdout.write(JSON.stringify(evaluated.event) + "\n");
        }
      } else if (emit) {
        if (evaluated.shouldAlert) {
          console.log("");
          console.log(
            pc.bgRed(pc.white(pc.bold(" ALERT "))) +
              pc.red(
                ` Compaction would DROP: ${evaluated.alertSkills.map((s) => "/" + s).join(", ")}`,
              ),
          );
        } else if (cleared) {
          console.log(pc.green("\nCleared — no DROP alerts.\n"));
        }
        process.stdout.write(
          formatTable(evaluated.sim.result, {
            title: "carrycut watch — session guardian",
            suggestions: evaluated.sim.suggestions,
            warnings: evaluated.sim.warnings,
            sessionPath: source.sessionPath,
            sessionSkillCount:
              source.sessionSkillCount ?? source.skills.length,
            lastCompactAt: source.lastCompactAt,
          }),
        );
      }

      previousAlertKey = evaluated.alertSkills.length
        ? evaluated.alertKey
        : "";
      firstTick = false;

      return evaluated.exitCode;
    };

    if (opts.once) {
      process.exit(runTick());
    }

    if (!opts.json) {
      console.log(
        pc.dim(
          `Watching session every ${intervalSec}s (Ctrl+C to stop). Alerts are edge-triggered.`,
        ),
      );
    }

    let lastExit = runTick();
    while (!stop) {
      await sleep(intervalSec * 1000);
      if (stop) break;
      lastExit = runTick();
    }

    process.exit(lastExit);
  });

program
  .command("stale")
  .description(
    "Detect stale re-attach: SKILL.md changed on disk after last invocation",
  )
  .option(
    "--invoked <list>",
    "Comma-separated skill names (needs --session for timestamps)",
  )
  .option(
    "--session <path>",
    'Session JSONL path, or "auto" to find the latest transcript',
  )
  .option("--hash", "Include content hash in the report")
  .option("--mtime", "Use mtime comparison (default)", true)
  .option("--json", "Machine-readable JSON output")
  .option(
    "--calibration <factor>",
    "Unused for stale; accepted for flag consistency",
    String(DEFAULT_CALIBRATION),
  )
  .option(
    "--skills-root <dir>",
    "Extra directory of <name>/SKILL.md trees",
  )
  .action((opts: {
    invoked?: string;
    session?: string;
    hash?: boolean;
    json?: boolean;
    skillsRoot?: string;
  }) => {
    if (!opts.invoked && !opts.session) {
      console.error(
        pc.red(
          "Error: provide --invoked skillA,skillB and/or --session auto|<path>",
        ),
      );
      process.exit(2);
    }

    const source = resolveInvocationSource({
      invoked: opts.invoked,
      session: opts.session,
      skillsRoot: opts.skillsRoot,
    });

    if (source.skills.length === 0 && !opts.invoked) {
      if (opts.json) {
        const payload: StaleJsonOutput = {
          ok: false,
          entries: [],
          warnings: source.warnings,
        };
        printJson(payload);
      } else {
        for (const w of source.warnings) console.error(pc.yellow(w));
      }
      process.exit(2);
    }

    const { entries, warnings } = detectStale(source.skills, {
      preferHash: Boolean(opts.hash),
    });
    const allWarnings = [...source.warnings, ...warnings];
    const anyStale = entries.some((e) => e.stale);

    if (opts.json) {
      const payload: StaleJsonOutput = {
        ok: !anyStale,
        entries,
        warnings: allWarnings,
      };
      printJson(payload);
    } else {
      console.log("");
      console.log(pc.bold("carrycut stale — re-attach freshness check"));
      if (source.sessionPath) {
        console.log(pc.dim(`Session: ${source.sessionPath}`));
      }
      if (source.lastCompactAt) {
        console.log(pc.dim(`Last compaction: ${source.lastCompactAt}`));
      }
      console.log("");
      for (const e of entries) {
        const mark = e.stale ? pc.red("STALE") : pc.green("OK   ");
        console.log(`${mark}  ${e.name}`);
        console.log(pc.dim(`       ${e.reason}`));
        if (e.path) console.log(pc.dim(`       ${e.path}`));
        if (opts.hash && e.contentHash) {
          console.log(pc.dim(`       hash: ${e.contentHash}`));
        }
      }
      if (allWarnings.length) {
        console.log("");
        console.log(pc.yellow("Warnings:"));
        for (const w of allWarnings) console.log(pc.yellow(`  • ${w}`));
      }
      console.log("");
    }

    process.exit(anyStale ? 1 : 0);
  });

program.parse();
