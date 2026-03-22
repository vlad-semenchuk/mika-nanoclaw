---
description: Git workflow rules for this project
globs:
alwaysApply: true
---

# Git Workflow

## Branch Strategy

Work directly on `main` for small fixes and changes. For larger features, create a feature branch off `main` and merge back via PR.

## Commit Message Format

Use conventional commit prefixes:

- `feat:` — new feature
- `fix:` — bug fix
- `refactor:` — code restructuring without behavior change
- `chore:` — maintenance, deps, config, version bumps
- `ci:` — CI/CD workflow changes
- `docs:` — documentation only

Keep the subject line concise (under 72 chars). Use lowercase after the prefix. No trailing period.

Never include `Co-Authored-By:` trailers.

## Commits

Before committing, analyze the staged and unstaged changes to decide whether they should go into a single commit or be split into multiple commits.

Split into separate commits when:
- Changes touch unrelated areas (e.g., a bug fix and a new feature)
- There are distinct logical units of work (e.g., a refactor followed by new functionality built on top)
- CI/config changes are mixed with source code changes

Use a single commit when:
- All changes serve one purpose (e.g., implementing one feature across multiple files)
- Changes are tightly coupled and wouldn't make sense independently

When splitting, stage files selectively (`git add <file>`) rather than using `git add -A`. Commit each logical group with its own descriptive message.

## Build Before Restart

After committing code changes, always run `npm run build` and restart the service to verify the build succeeds. The service runs compiled JS from `dist/` — uncommitted or unbuilt changes have no effect in production.
