# Cycle v1 — setup

## 1. Put it on GitHub Pages
1. Create a new repository, for example `Wellness`, the same way as `Finance`.
2. Upload all files from this zip (keep the `icons` folder; `tests` is optional).
3. Settings → Pages → deploy from the main branch, root folder.
4. Open `https://<your-github-name>.github.io/Wellness/` on the iPhone → Share → Add to Home Screen.

The app works without step 2 below; sync just stays off.

## 2. Google Drive sync (optional, about 5 minutes)
You can reuse the Google Cloud project you made for Finances:
1. console.cloud.google.com → your Finances project → APIs & Services → Credentials → open the existing OAuth client.
2. Under Authorized redirect URIs, add `https://<your-github-name>.github.io/Wellness/` (with the trailing slash). The JavaScript origin is already there.
3. OAuth consent screen → Test users: make sure the Google account your wife will use is listed.
4. Copy the Client ID into `config.js` on GitHub and commit.
5. Close the Home Screen app completely and open it twice, so it picks up the new config.

Note: Google's sign-in screen will show the project's name ("Finances"). If you prefer it to say "Cycle", create a separate project instead and repeat the Finances steps there (Drive API only; no Picker or API key needed).

## 3. First start (on her iPhone)
Set up on this phone → answers → passphrase (write it down; it cannot be recovered) → Face ID.
Then Settings → Google Drive sync → Sign in → Create vault.
On another device: "I already use Cycle on another device" → sign in → passphrase.

## Good to know
- Both apps live on the same web address. Cycle uses its own database, storage keys, offline cache and passkey,
  so they do not touch each other. It also means the security of your GitHub account protects both apps.
- Sign-in to Google lasts about an hour; the status pill says "Sign in to sync" when it has expired.
- Run the tests on a computer with Node: `node tests/engine.test.mjs`.
