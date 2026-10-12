---
name: GitHub push authentication
description: What to do when GitHub's Replit connection appears healthy but workspace shell pushes still fail.
---

In this workspace, attaching the GitHub source-control connection did not authenticate `git push` from the shell. Reauthorization was also unavailable even though the connection reported healthy.

**Why:** the shell returned an authentication failure while the integration status and permissions appeared healthy, so repeated retries or asking the user for a token would not be appropriate.

**How to apply:** prepare and verify the requested branch locally, avoid asking for credentials or attempting manual token configuration, and have the user publish through their authenticated GitHub client or workspace UI.
