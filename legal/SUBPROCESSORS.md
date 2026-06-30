# Subprocessors

**Last updated:** [DATE]

> Draft template — not legal advice. Keep this list accurate; it is referenced
> by the Privacy Policy and may be contractually required for business customers.

[COMPANY LEGAL NAME] uses the third-party processors below to provide the AI
Video Editor. We require each to protect personal data consistent with our
[Privacy Policy](PRIVACY_POLICY.md).

| Processor | Purpose | Data processed | Location | Notes |
|-----------|---------|----------------|----------|-------|
| **Clerk** | Authentication & user/account management | Account identifiers, email, name, session, subscription tier | [US] | Configured via `CLERK_SECRET_KEY`. Required for auth. |
| **OpenAI** (or configured `OPENAI_BASE_URL` provider) | LLM refinement of the edit timeline | Video **transcript text** and edit metadata (no raw video) | [US] | Optional — only if `OPENAI_API_KEY` is set. Disable to keep all processing in-house (deterministic mode). Provider terms must prohibit training on your data. |
| **Hugging Face** | Distribution of the Whisper speech-to-text model weights | Model download only (no user content sent) | [US/EU] | Model is downloaded to our infrastructure; transcription runs locally. |
| **[Hosting/Cloud provider]** | Compute, storage of uploads/exports, networking | All categories at rest/in transit | [REGION] | Fill in your actual host. |
| **[Payment processor]** | Billing & subscriptions | Billing/transaction metadata | [REGION] | If billing is handled outside Clerk. |

## Notes

- **Self-hosted models.** Whisper (speech-to-text) and the saliency/scene
  models run on our own infrastructure; **audio and video are not sent to a
  third party for those steps.** Only the resulting transcript text is sent to
  the LLM provider, and only when AI generation is enabled.
- **Changes.** We will update this page when we add or replace a subprocessor.
  Business customers requiring advance notice should subscribe at
  [SUBPROCESSOR NOTICE SIGNUP], if offered.
