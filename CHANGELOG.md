# Cycle — change log

## v2 — 3 Oct 2026 (Phases 2 + 3: symptoms, safety and nutrition)
Requirements FR-12 to FR-17 (spec v0.3 Sections 5 and 6). Upload over v1; data carries over.

- Daily check-in with questions for the current phase; any symptom on any day with mild / moderate / severe; notes and medicines.
- Fixed, sourced suggestions per symptom (ACOG, Mayo Clinic); symptoms without one get a "talk to a doctor if severe" line.
- Warning cards: soaking hourly, heavy bleeding with dizziness (seek care today); changes under 2 hours, period over 7 days,
  large clots, bleeding between periods, severe cramps two cycles running, cycles outside 24–38 twice (see a doctor);
  very low mood on several days (TelefonSeelsorge 0800 111 0 111). Each card must be acknowledged to hide it.
- Food tab: iron + vitamin C during the period (NIH values, no red meat), balanced plate mid-cycle,
  calcium and complex carbohydrates before the period; heavy-bleeding iron note.
- Fix: a period that runs longer than usual without a logged end now stays "Period" on every screen.
- Tests: 49 engine and 25 warning-rule unit tests; v1→v2 upgrade tested in the browser.

## v1 — 3 Oct 2026 (Phase 1: core cycle tracker)
Built from spec v0.3. Requirements: FR-01 to FR-11, FR-27, FR-29; NFR-01 to NFR-13.

- Onboarding: last period, usual cycle and period length ("I don't know" allowed), age band, disclaimer.
- Encryption: everything stored on the device is sealed with a passphrase (AES-GCM 256, PBKDF2 310,000 rounds).
- Face ID / Touch ID unlock (same method as Finances v14); auto-lock after 5 minutes in the background.
- Today: cycle ring with phase arcs, cycle day, state, next period with range, confidence, 7-day strip.
- Logging: period started / ended (today or any past day), daily bleeding level, mid-cycle "period or spotting?" prompt.
- Calendar: logged and predicted periods, peak and possible fertile days, likely ovulation, 3 cycles ahead.
- History: averages, every period with edit, exclude (with reason), delete; add past periods; overlap check.
- Late period: note with backfill button and home-test hint; forecasts pause until the period is logged.
- FIGO 24–38 day notes: one cycle outside → info; two in a row → "discuss with a doctor".
- Pregnancy-chance wording (optional, with warning); no day is ever shown as safe.
- Encrypted Google Drive sync and restore on another device (needs the Google ID in config.js).
- Export backup (JSON) and periods (CSV), import backup, delete all data. Works offline.
- Tests: 46 engine unit tests (incl. spec 3.7 worked example, leap year, late period) and an end-to-end browser test.
