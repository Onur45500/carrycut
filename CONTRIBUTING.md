# Contributing to carrycut

Thanks for helping improve carrycut. This project is an offline diagnostic CLI for Claude Code skill compaction — keep changes focused, tested, and free of runtime network calls.

## Prerequisites

- Node.js ≥ 18
- npm 9+

## Setup

```bash
npm install
npm test
npm run build
```

## Local usage

```bash
npm run dev -- sim --invoked auth-helper,pdf-tools --skills-root demo/skills
npm run dev -- watch --once --invoked auth-helper,pdf-tools,git-flow,deploy-guard,release-notes,context-hoarder --skills-root demo/skills
node dist/cli.js sim --session auto
```

Demo skills live under [`demo/skills/`](demo/skills/). See [demo/README.md](demo/README.md).

## Guidelines

- Prefer pure functions in `src/core/` (easy to unit test).
- Do not add runtime network dependencies.
- Keep token counts clearly documented as **estimates**.
- Add or update tests under `test/` for engine, transcript, and watch behavior.
- Match existing TypeScript style (strict, ESM, named exports outside Next-style pages).

## Pull requests

1. Fork and branch from `main`.
2. Make your change with tests.
3. Ensure `npm test` and `npm run build` pass.
4. Open a PR using the template; describe **why**, not only what.

## Publishing (maintainers)

[`carrycut@2.0.0`](https://www.npmjs.com/package/carrycut) is live on npm.

For later releases:

```bash
npm test
npm run build
npm version patch   # or minor / major
npm publish
```

Before linking the GitHub repo publicly, replace `YOUR_GITHUB_USER` in `README.md` badges and `package.json` `repository` / `homepage` / `bugs`.

The npm tarball includes `dist/`, `README.md`, and `LICENSE` (demo fixtures stay in git only). Run `npm pkg fix` if npm warns about the `bin` field on publish.

## Code of conduct

Please follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Security

See [SECURITY.md](SECURITY.md).
