# Cycle — setup

## 1. Publish with GitHub Pages
1. Settings → Pages → deploy from branch `main`, root folder.
2. Open `https://<github-name>.github.io/<repo>/` on the iPhone → Share → Add to Home Screen.
3. Always open Cycle the same way afterwards (Home Screen icon or Safari): the two keep separate data on an iPhone.

The app works without step 2 below; sync just stays off.

## 2. Google Drive sync (optional)
1. In a Google Cloud project with the Google Drive API enabled, open the OAuth client (type: Web application).
2. Authorized JavaScript origin: `https://<github-name>.github.io`. Authorized redirect URI: the app's address from step 1, with the trailing slash.
3. OAuth consent screen → Test users: list every Google account that will use Cycle.
4. Put the Client ID into `config.js` on GitHub and commit. Builds never contain `config.js`, so an upload or merge does not overwrite it.
5. Close the Home Screen app completely and open it again.

## 3. First start
Set up on this phone → answers → passphrase (save it in Passwords and write it down; it cannot be recovered) → Face ID.
Optional: Settings → Support line; Settings → Google Drive sync → Sign in → Create vault (or Join vault).
On another device: "Restore from Google Drive" → sign in → vault passphrase.

## Good to know
- Cycle uses its own database, storage keys, offline cache and passkey, so other apps on the same web address are not touched.
- Google sign-in lasts about an hour; the status pill says "Sign in to sync" when it has expired.
- Tests: `npm install`, `npx playwright install chromium webkit`, `npm test`.
