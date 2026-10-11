---
name: Workspace dependency-install safety
description: Protects monorepo workspace security settings when adding dependencies with pnpm.
---

After adding dependencies in this monorepo, inspect the workspace configuration diff and preserve the existing `minimumReleaseAge` safeguard and catalog constraints. A pnpm install/update unexpectedly rewrote the workspace file and removed its package-age protection; the safeguard was restored before continuing.

**Why:** Workspace dependency changes must not silently weaken the repository's supply-chain protections.

**How to apply:** After package changes, review `git diff -- pnpm-workspace.yaml` and confirm security settings and unrelated workspace options remain unchanged.
