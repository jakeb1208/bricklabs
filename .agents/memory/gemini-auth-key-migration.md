---
name: Gemini authorization-key migration
description: Google's migration from standard Gemini API keys to authorization keys and the resulting 401 troubleshooting.
---

Google's Gemini API documentation states that, beginning May 28, 2026, new Google AI Studio API keys are authorization keys by default; unrestricted standard keys are also rejected. Google AI Developers Forum users have reported `401 UNAUTHENTICATED` / `ACCESS_TOKEN_TYPE_UNSUPPORTED` with newly issued authorization keys.

**Why:** Older guides assume a newly generated AI Studio key is a legacy standard key, which can lead to repeated key rotation when the actual issue is an authentication-type compatibility problem.

**How to apply:** If a fresh AI Studio key still gets HTTP 401, do not keep rotating keys or change the model blindly. Surface the upstream Gemini error safely (redact the key), check the key type in AI Studio, and only change the authentication flow after confirming the provider's error details. Google's current documentation still shows `x-goog-api-key` for Gemini API requests, so do not assume a different header is the fix.
