# Updates: how a push to GitHub reaches every installed Mediescare

Decision record: [ADR-0015](adr/0015-auto-updates-built-in-cloud-and-clear-database.md).

## For the developer

1. Push to `main` on `github.com/ThemedEdits/mediescare`.
2. GitHub Actions (`.github/workflows/ci.yml`) runs lint, typecheck, tests, builds and smoke-tests the packaged app, then the `release` job builds the Windows installer and publishes a **GitHub Release** named `v<major>.<minor>.<run number>` (for example `v0.1.57`). If any check fails, nothing is released.
3. To release a bigger version, change `version` in `apps/desktop/package.json` (for example `0.2.0`); CI keeps major and minor and replaces the patch.

One-time GitHub setting: **Settings > Actions > General > Workflow permissions** must allow "Read and write" (or keep the default and rely on `permissions: contents: write` in the job, which is already set).

The repository must stay **public** for the app to read releases without a token. Never commit `.env` or any password: the release is public too.

## For the user at the pharmacy

- Mediescare checks for updates 30 seconds after it starts and every 4 hours, only when there is internet. Offline it simply keeps working.
- **"Update available"**: choose **Download update**. Selling continues while it downloads (progress shows on the taskbar icon).
- **"Update ready"**: finish the open sale, then **Restart now**. Mediescare closes, installs and opens again in a few seconds. **Later** installs it the next time Mediescare is closed.
- **Help > Check for updates** checks at once.
- Data is not touched by an update. If the update changes the database, a backup is taken automatically first (shown as "Before update" in Backups).
- Branch server and terminals each update themselves. Update the branch server first when possible; terminals show the server's screens, so they always match it.

## First install

Download `Mediescare-Setup-<version>.exe` from the newest release at `https://github.com/ThemedEdits/mediescare/releases/latest`. The installer is not code-signed yet, so Windows SmartScreen may show "Windows protected your PC": choose **More info > Run anyway**. Later updates install without this prompt.
