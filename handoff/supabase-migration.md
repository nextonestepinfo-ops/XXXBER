# XXXBER Supabase Migration Handoff

## Current State

- The production app is a single-page GitHub Pages app at `https://nextonestepinfo-ops.github.io/XXXBER/`.
- The emergency recovery app lives at `/recovery/` and keeps the current Google Apps Script / Google Sheets backend for now.
- The recovery app reads from the production GAS endpoint, but production writes are disabled by default. `RECOVERY_WRITE_API_URL` is intentionally blank in `recovery/index.html`.
- To write from the recovery app to a separate spreadsheet, create a recovery-only spreadsheet and deploy a recovery-only GAS endpoint that supports the same `action=get` / `action=set` contract, then set `RECOVERY_WRITE_API_URL` to that endpoint.
- The app currently stores seven JSON datasets:
  - `sales-manager-entries`
  - `sales-manager-open-tabs`
  - `sales-manager-staff`
  - `sales-manager-menu`
  - `sales-manager-advances`
  - `sales-manager-cashbox`
  - `sales-manager-expenses`
- The main production risk is whole-array overwrites from multiple devices. Failed saves used to look successful because the client did not inspect the GAS response.
- Do not point `RECOVERY_WRITE_API_URL` at the production GAS endpoint unless the operator explicitly wants to overwrite the production storage.

## Recommended Migration Path

### Phase 1: Mirror Existing JSON Shape

Create Supabase tables that keep the existing object shape first. Do not redesign every field during the first migration.

Recommended tables:

- `entries`
- `open_tabs`
- `staff`
- `menu`
- `advances`
- `cashbox`
- `expenses`

Minimum columns for each table:

- `id text primary key`
- `payload jsonb not null`
- `updated_at timestamptz not null default now()`
- `deleted_at timestamptz`

For datasets that currently have no stable item ID, generate one during import and store the original row inside `payload`.

### Phase 2: Swap Reads and Writes

- Replace GAS `action=get` reads with Supabase `select`.
- Replace GAS `action=set` whole-key writes with row-level upserts.
- Keep Google Sheets as export/reporting only, not as the operational database.
- Keep the emergency outbox behavior until Supabase save/retry behavior has been proven on multiple phones.

### Phase 3: Real-Time Multi-Device Sync

- Enable Supabase Realtime for `entries` and `open_tabs` first.
- Subscribe to inserts, updates, and soft deletes.
- Update the UI by item ID instead of replacing whole arrays.
- Keep a visible connection/sync state in the header.

### Phase 4: Auth and Permissions

- Start by preserving the current staff/PIN login to avoid changing shop operations during the DB migration.
- Add Supabase Auth later when the workflow is stable.
- Map roles to app behavior:
  - `master`: full access
  - `owner`: own owner scope
  - `manager`: manager scope
  - `staff`: own sales and unpaid tickets
  - `catch`: referral/catch views

### Phase 5: GAS Cleanup

- Move receipt generation and sheet exports after the core save path is stable.
- Options:
  - Supabase Edge Functions for receipts/API work.
  - Scheduled export job to Google Sheets for accounting/reporting.
  - Keep GAS only as a report writer if that is fastest operationally.

## Acceptance Criteria

- Two devices can create different open tabs at the same time without either tab disappearing.
- A device can go offline or fail to save and then retry without data loss.
- A confirmed sale is stored as a row-level upsert, not by replacing the full `entries` array.
- Google Sheets can still receive backup/export data, but the app does not depend on Sheets for live writes.
- The old GitHub Pages production app remains available until the Supabase version is validated.

## Import Notes

- Use the recovery app's export buttons to capture local, server, and unsynced snapshots before migration.
- Prefer importing from the recovery JSON snapshot because it preserves the seven existing keys exactly.
- If importing from CSV, use `tools/build-recovery-seed.mjs` first to normalize the CSV into `recovery/seed-data.js`, then convert the resulting JSON into Supabase rows.
