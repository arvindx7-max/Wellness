# Cycle — change log

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
