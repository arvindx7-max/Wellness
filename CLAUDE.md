# Cycle — notes for Claude and reviewers

Cycle is a private Home Screen web app (phone and laptop) for tracking periods, fertile days, symptoms and
phase-based food guidance. Plain HTML, CSS and JavaScript modules, published from `main` with GitHub Pages.
All user data stays on the device (encrypted) or in the user's own Google Drive vault (encrypted).

# SECURITY AND PRIVACY MANDATE
This repository is strictly PUBLIC. Under no circumstances may any sensitive, personal, or proprietary information be committed to this codebase.

## 1. Zero-Tolerance Data Policy
Do NOT generate, suggest, or include any of the following in source code, comments, commit messages, or documentation:
*   Real names, relationships, addresses, or contact information.
*   Personal health data, cycle and nutrition metrics, or specific dates.
*   API keys, access tokens, passwords, or cryptographic secrets.
*   Real internal network IP addresses or specific local file paths from my machine.

## 2. Mock Data Requirement
All tests, UI visual prototypes, state-machine edge case validations, and database seeds MUST use explicitly fabricated dummy data (e.g., `user_test_123`, `example@domain.com`, `dummy_metric_A`).

## 3. The "Hard Stop" Rule
If a required feature, database schema, or local encryption implementation seems to necessitate hardcoding user-specific logic or personal data, DO NOT write the code. Stop the process and explicitly ask me for clarification on how to abstract it securely.

## 4. Reviewer Checklist (For Gemini)
When executing `@gemini-cli /review`, Gemini must prioritize verifying compliance with this privacy mandate before assessing code quality. If any potential leak of personal data, real-world metrics, or secrets is detected in the pull request diff, Gemini must immediately fail the review and flag the exact line.

## How the mandate is read here
- "Specific dates" means personal dates. Date-handling code, invented test dates and build or release dates are fine.
- Public browser IDs are allowed in `config.js` (the Google OAuth client ID). Secrets never.
- Built-in catalogues, defaults and wording stay neutral. Anything specific to one person (diet, age band, support line,
  cycle history) is a setting stored only in the user's encrypted data, never in the code.
- When reporting a suspected leak, give the file, line and category only. Never repeat the value.
- Mock emails use only `@example.com` or `@example.org`.

## Never paste real data
Never put real logs, exports, screenshots or personal details into GitHub (code, commits, branches, pull requests)
or the Gemini app. Tests and examples use only the mock data ledger below.

## Mock data ledger
Only these clearly fake values may appear in tests, prototypes and examples.

| Item | Mock value |
| --- | --- |
| User | `user_test_123`, `Alice Placeholder` |
| Email | `alice@example.com` |
| Passphrase | `test-passphrase-only` (wrong one: `wrong-passphrase`) |
| Period dates | invented 2026 dates, e.g. `2026-06-24` to `2026-06-28`, `2026-07-25` to `2026-07-29`, `2026-08-24` to `2026-08-28`, `2026-09-23` |
| Test "today" | `2026-10-03` |
| Usual cycle length | `30` days (any value 15–90 for edge cases) |
| Birth year | `1990` (test fixture only; the app has no default) |
| Diet | `vegetarian` (test fixture only; the app has no default) |
| Support line | name `Test Support Line`, number `+00 000 000` |
| Google client ID | empty, or `test-client-id.apps.googleusercontent.com` |
| Metrics | `dummy_metric_A` |

## Workflow
1. A request or bug is reported in the app's chat; Claude explains the cause and fix and logs it in the private change log. No build yet.
2. "log it" = change log only. "build" = build.
3. Build on a branch named after the version (e.g. `v2.3`). Test at 390 × 844 and 1470 px, light and dark; `npm test`.
4. Privacy halt: changed files, privacy check, "No personal data in this change". Wait for "push".
5. Push the branch and open a draft pull request. Commit messages and the title start with the version number.
   Plain files only: never commit a zip or `config.js` changes from a build.
6. Gemini reviews the branch with the change review prompt in `docs/review-prompts.md`.
7. Claude assesses each finding; the owner decides; Claude revises the same branch (privacy halt again).
8. The owner marks it ready, checks the diff and merges. `main` is live.

The change log is private (kept outside this repository).

## Layout and tests
- Engine, rules, look, import and sync: `tests/engine.test.mjs`, `tests/rules.test.mjs`, `tests/look.test.mjs`, `tests/importer.test.mjs` (date finder for PDF, CSV and pasted text), `tests/cloud.test.mjs` (per-field sync merge; `npm run test:unit`; the look test checks that every theme is readable, 4.5:1).
- Browser: `tests/e2e.mjs` at phone 390 × 844, phone landscape 844 × 390 and laptop 1470 × 956, light and dark,
  Chromium and WebKit. Fails on sideways scrolling, a laptop page using less than 80% of the usable width,
  a header readout that does not fit on the first screen, a laptop ring that does not fit, wrong food filtering or unencrypted storage.
- GitHub Actions runs both on every branch push and pull request; screenshots are kept as a build artifact.
