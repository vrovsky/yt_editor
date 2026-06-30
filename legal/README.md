# Legal & Compliance Documents

This folder contains the customer-facing legal documents for the AI Video Editor service.

> ⚠️ **These are drafts/templates, not legal advice.** Placeholders in
> `[BRACKETS]` (company name, jurisdiction, contact, dates) must be filled in,
> and the whole set must be reviewed by qualified counsel for your
> jurisdiction(s) before you launch or charge money.

| Document | Purpose |
|----------|---------|
| [`TERMS_OF_SERVICE.md`](TERMS_OF_SERVICE.md) | The contract governing use of the service, including the user content-rights warranty, billing, and liability limits. |
| [`PRIVACY_POLICY.md`](PRIVACY_POLICY.md) | What personal data is collected, why, retention, deletion rights, and third-party processors. |
| [`ACCEPTABLE_USE_POLICY.md`](ACCEPTABLE_USE_POLICY.md) | What users may not upload or do with the service. |
| [`SUBPROCESSORS.md`](SUBPROCESSORS.md) | The third parties that process customer/personal data on our behalf. |

## Open compliance items (track to launch)

- [ ] Fill all `[BRACKETS]` placeholders and set the effective date.
- [ ] Counsel review (consumer terms, auto-renewal disclosures, GDPR/CCPA).
- [ ] Wire the **content-rights checkbox** at upload (TOS §4) into the UI.
- [ ] Confirm the **OpenAI data flow** (transcripts in prompts) matches the
      Privacy Policy and is opt-in where required. If you do not want transcript
      text to leave your infrastructure, run with the deterministic path only
      (no `OPENAI_API_KEY`).
- [ ] Verify the bundled **ffmpeg** build's license (see `THIRD_PARTY_NOTICES.md`).
