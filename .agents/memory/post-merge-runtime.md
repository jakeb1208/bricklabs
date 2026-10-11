---
name: Post-merge runtime budget
description: Runtime expectations for the repository's post-merge dependency install and schema check.
---

The configured post-merge script runs a frozen workspace install and then a database schema push. Even when dependencies are already current, the install can take about 30 seconds in this environment; the combined setup completed in about 28.5 seconds once the timeout was raised to 90 seconds.

**Why:** A 20-second timeout is shorter than the normal setup runtime and makes otherwise successful merges appear broken.

**How to apply:** Keep a generous post-merge timeout (currently 90 seconds) and retain the frozen-lockfile install; inspect fresh logs if package or database changes increase runtime.
