# Demo skills

Oversized fixture skills for the Show HN / README scenario. Each body is padded past the 5,000-token per-skill re-attach cap so a six-skill session exhausts the 25,000 combined budget and **DROPs** the oldest (`auth-helper`).

| Skill | Role |
|-------|------|
| `auth-helper` | Important skill invoked first — silently dropped |
| `pdf-tools` | Mid-session |
| `git-flow` | Mid-session |
| `deploy-guard` | Includes `!`cmd`` dynamic context (`~DYNAMIC`) |
| `release-notes` | Near-newest |
| `context-hoarder` | Huge newest skill crowding the budget |

```bash
node dist/cli.js sim \
  --invoked auth-helper,pdf-tools,git-flow,deploy-guard,release-notes,context-hoarder \
  --skills-root demo/skills \
  --critical auth-helper
```
