# Current Sprint

**Sprint 4 — CLOSED 2026-04-28** · Released as v0.4.0 (pending [release-manager]).

**Goal (achieved):** Closed Phase A core. Real Japan 2026 trip data importable via Trello script. Budget + expenses with per-member balances. Profile management with avatars.

---

## Active Items

*(none — sprint closed)*

---

## Completed This Sprint

- [B-014] Budget & expenses — UAT PASS 2026-04-28
- [B-016] Japan 2026 Trello import — UAT PASS-with-WARN 2026-04-28 (transport mode regex matches "airport" in `flight` before `bus` — non-blocking; flagged as follow-up)
- [B-017] Profile management — UAT PASS-with-WARN 2026-04-28 (server-side MIME validation delegated to Storage bucket policy rather than app-layer route — security outcome equivalent; architect-approved in R2)

---

## Sprint 4 Outcome

3 items shipped. Migrations: 0011 (Trello import schema delta), 0012 (expenses table + balances RPC), 0013 (avatars Storage bucket + RLS), 0014 (expense_total RPC + RLS with-check tightening from R4 review). 584/584 vitest tests passing (+116 new). 7 R4 findings fixed (2 HIGH B-016, 2 HIGH B-014, plus MEDIUM cleanups across all three).

**Browser UAT checklist** for the user (sole tester) deferred to `app/docs/uat/sprint-4-browser-checklist.md`.

---

## Sprint 3 Outcome (closed 2026-04-28)

3 items shipped (B-007, B-008, B-013). Migrations: 0008–0010. Released as v0.3.0. Full archive in SPRINT_ARCHIVE.md.

---

## Sprint 2 Outcome (closed 2026-04-26)

5 items shipped (B-009, B-010, B-011, B-012, B-019). Migrations: 0003–0007. Released as v0.2.0.

---

## Sprint 1 Outcome (closed 2026-04-24)

7 items shipped (B-001..B-006, B-018). Migrations: 0001_init, 0002_audit_log. Released as v0.1.0.

---

## Next

- Sprint 5 — not yet opened. Candidates: B-015 Leaflet map (deferred from S4); follow-up: fix `inferTransportMode` keyword priority for "Bus to airport" mis-routing; remaining backlog items.
