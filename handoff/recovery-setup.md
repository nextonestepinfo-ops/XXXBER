# XXXBER Recovery Sheet Setup

## Created Recovery Spreadsheet

- Title: `XXXBER リカバリー用ストア 2026-06-29`
- Spreadsheet ID: `1I6mEnagIY_ByAwg9vybJZ4SUWgaANiFdbQYgrS3k_EY`
- URL: https://docs.google.com/spreadsheets/d/1I6mEnagIY_ByAwg9vybJZ4SUWgaANiFdbQYgrS3k_EY

The sheet already contains the private imported sales records. Keep record counts,
customer names, and sales amounts inside the spreadsheet only; do not publish them
in GitHub Pages assets or public handoff notes.

## Important Safety Rule

The recovery app currently has production writes disabled:

```js
const RECOVERY_WRITE_API_URL = "";
```

Do not point the recovery app at the production GAS URL. Use a recovery-only GAS deployment.

## GAS Deployment Steps

1. Open the recovery spreadsheet above.
2. Go to `Extensions` -> `Apps Script`.
3. Replace the default script with `handoff/recovery-gas-webapp.gs`.
4. Save the script as `XXXBER Recovery GAS`.
5. Deploy as a Web App:
   - Execute as: `Me`
   - Who has access: `Anyone with the link` or the narrowest setting that still works on the shop devices
6. Copy the Web App `/exec` URL.
7. Paste that URL into `recovery/index.html`:

```js
const RECOVERY_WRITE_API_URL = "PASTE_RECOVERY_WEB_APP_EXEC_URL_HERE";
```

Or, without editing code, open this once on each shop device:

```text
https://nextonestepinfo-ops.github.io/XXXBER/recovery/?recoveryApi=PASTE_RECOVERY_WEB_APP_EXEC_URL_HERE
```

After this, the recovery app reads and writes the recovery spreadsheet, not production.

## Verification

After deploying and setting the URL:

1. Open `/recovery/`.
2. Confirm the header no longer says `本番書込OFF`.
3. Create a small test open tab and save it.
4. Confirm `app_store` updates in the recovery spreadsheet.
5. Confirm production spreadsheet data was not changed.
