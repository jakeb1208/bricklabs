---
name: Python shell module side effect
description: A Python shell invocation may alter the Replit module list in `.replit`.
---

A Python shell invocation may automatically add a `python-base` module entry to `.replit`, even when Python is used only for temporary parsing.

**Why:** A temporary configuration comparison unexpectedly changed the workspace module list.

**How to apply:** Prefer Node.js or shell for scratch parsing when practical. If `.replit` changes unexpectedly, restore its original TOML through the validated `verifyAndReplaceDotReplit` flow rather than editing it directly.
