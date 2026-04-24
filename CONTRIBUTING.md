# Contributing

Thank you for considering a contribution. This is a personal project
that grew past one author's house — improvements are welcome.

## How to propose a change

1. Open an issue first for anything non-trivial. Lets us align before
   you spend time.
2. Fork, branch from `main` (`feat/foo` for features, `fix/foo` for
   fixes, `chore/foo` for housekeeping).
3. `bun run typecheck` must pass locally.
4. Open a pull request. CI runs `docker build` for both amd64 and
   aarch64 and re-runs typecheck.

## What I'm looking for

Good candidates for a PR:

- New per-brand seeds in [`house-inventory/src/brand-seeds.ts`](house-inventory/src/brand-seeds.ts)
  for manufacturers you actually own. Keep the list honest; don't seed
  a brand you can't verify the real support portal for.
- Classifier improvements in [`house-inventory/src/filters.ts`](house-inventory/src/filters.ts)
  for categories of HA devices that keep getting misclassified.
- UI polish — the frontend is a React 19 SPA with TanStack Router +
  TanStack Query, styled with plain CSS (no CSS framework). Keep it
  lightweight: no heavy UI libraries.
- Bug fixes + extra test coverage.

Things I probably won't merge:

- Model-recommendation changes ("switch to Claude for better results",
  "use GPT-5"). The model is the user's choice. Code-side improvements
  (better prompts, more validation) are always welcome.
- Feature that requires write access to HA's `/config` or any volume
  other than our own `/data`.

## Code style

- TypeScript strict, `noUncheckedIndexedAccess` on.
- Prefer small well-commented modules. Comments should say *why*, not
  *what*.
- Migrations are append-only. Never edit a shipped migration; add a
  new one.
- No lint/format tooling is enforced yet — keep it readable.

## Local development

```sh
cd house-inventory
cp .env.example .env       # set HA_BASE_URL + HA_TOKEN (a long-lived token)
bun install
bun run dev
```

Then browse to `http://localhost:8099`. The dev server reads / writes
the same SQLite schema as production, under `./data/` in the repo.

## VS Code devcontainer

A `.devcontainer.json` is included at the repo root for the HA
devcontainer workflow. Open the repo in VS Code → "Reopen in Container"
→ run the "Start Home Assistant" task. The add-on appears automatically
under Local Add-ons.

## License

By contributing, you agree that your contributions will be licensed
under the project's [MIT License](LICENSE).
