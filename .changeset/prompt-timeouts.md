---
"@aliou/pi-guardrails": minor
---

Add a shared configurable timeout for guardrails prompts with countdown UI. Dangerous-command and path-access prompts now auto-deny after the configured timeout, default to 5 minutes, and return a clearer "user is away / no explicit permission" block reason.
