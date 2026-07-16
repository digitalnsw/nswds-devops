# Coding Practices

General expectations for code in any digitalnsw repo. Language-specific
style is delegated to the linters ([Linting & Formatting](linting-and-formatting.md));
this guide covers the practices tools can't fully check.

## Rules

- **Never edit synced files in a consumer repo.** Anything with a
  "Synced from digitalnsw/nswds-devops — DO NOT EDIT" header (workflows,
  `scripts/`, commitlint/release configs, `renovate.json`) is overwritten by
  the next sync. Change it here instead — see [MAINTENANCE.md](../../MAINTENANCE.md).
- **Pin the toolchain in the repo.** `.nvmrc` is the source of truth for
  Node; CI and the release pipeline read it. Don't rely on whatever Node a
  laptop happens to have — a lockfile regenerated on a different npm version
  is churn at best and breakage at worst.
- **Comments explain constraints, not mechanics.** The shared configs are
  full of LOAD-BEARING comments (e.g. the `breakingHeaderPattern` note in
  `release.config.mjs`, the `HUSKY: 0` note in the release workflow) — each
  one exists because removing the line silently broke a release. Follow that
  pattern: when a line is only correct for a non-obvious reason, say so where
  the line lives.
- **Committed build artefacts are the exception, not the rule.** Only commit
  `dist/` where the release process requires it (nswds-app), and keep it in
  sync — CI checks it (`check-npm-artifacts` / `check:dist`).
- **Small, reviewable changes.** One concern per PR; the squash-merge
  strategy means each PR becomes exactly one conventional commit on `main`
  and one changelog line.
- **No secrets in code or config**, ever — GitHub repo secrets for CI,
  platform env vars (e.g. Vercel) for runtime. See [Environments](environments.md).

## TypeScript

- Enable **strict mode** in `tsconfig.json` — catch issues at compile time.
- Explicit types for function parameters and return values.
- Prefer `unknown` over `any`, then narrow; avoid `as` assertions unless
  there's no alternative (and comment why when there isn't).

```ts
interface User {
  id: string
  name: string
}

function greet(user: User): string {
  return `Hello, ${user.name}!`
}
```

## React components & hooks

- Functional components only; hooks for state and lifecycle logic.
- A component file exports a single default component, co-locates its
  styles where applicable, and keeps logic minimal — extract anything
  substantial to hooks or helpers.
- Custom hooks are prefixed `use` (e.g. `useUserData`), kept pure and
  composable — side effects live inside `useEffect`, nowhere else.

## State management

- Local state: `useState` / `useReducer`.
- App-wide shared state: context — sparingly. If context wiring gets
  complex, reach for a lightweight store (e.g. Zustand or Jotai) before a
  heavyweight one.

## Structure

- Pure, reusable logic lives in `/utils` (or `/hooks` for hooks) with
  names that say what they do (`formatDate`, `slugify`).
- Prefer a feature-based folder structure (`/features/auth/…`) over
  type-based buckets once a repo grows beyond a handful of components.
- Keep test files next to the files they test: `Component.test.tsx`
  ([Testing](testing.md)).

## Clean code

- Avoid deeply nested code — 2–3 levels; extract early returns or helpers.
- Meaningful, self-documenting names beat comments that restate mechanics.
- Remove unused variables and dead code — deletion is a feature.
- DRY, but don't over-abstract: the wrong abstraction costs more than a
  little duplication.
- Atomic commits: each represents a single logical change, small but not
  trivial, and passes lint/format checks
  ([Commit Messages](commit-messages.md)).

## When in doubt

Match the surrounding code. Consistency within a repo beats personal
preference, and consistency across repos is what this folder is for.
