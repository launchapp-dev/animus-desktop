# Animus Desktop — Distribution & Release Guide

This document is for the maintainer cutting Animus Desktop releases. It
covers the one-time Apple + Homebrew setup, the eight GitHub Actions
secrets the release pipeline needs, how to cut a release, how end users
install Animus, and how to debug a stuck pipeline.

If you are just trying to install Animus, jump to
[How users install Animus](#how-users-install-animus).

---

## TL;DR

- Pipeline lives at `.github/workflows/release.yml` and
  `.github/workflows/homebrew-update.yml`.
- Trigger: push a `v*` tag (e.g. `git tag v0.1.0 && git push origin v0.1.0`).
- Output: signed, notarized, stapled `.dmg` + `.app.tar.gz` + signed
  `latest.json` attached to a GitHub Release, plus an auto-PR against the
  Homebrew tap.
- One-time maintainer setup is roughly **2-3 hours of focused work**
  (Apple account waits not included). Most of it is one-way doors — once
  the secrets are in GitHub, every subsequent release is `git tag` +
  `git push`.

---

## One-time maintainer setup

You only do this once per project. After this, releases are a one-line
`git tag` push.

Rough time budget (assuming an existing Apple Developer account):

| Step                                       | Time     |
| ------------------------------------------ | -------- |
| Create Developer ID Application cert       | 15 min   |
| Export cert as `.p12` + base64             | 5 min    |
| Create App Store Connect API key (`.p8`)   | 10 min   |
| Generate Tauri updater key pair            | 5 min    |
| Add the eight secrets to GitHub repo       | 15 min   |
| Bootstrap `launchapp-dev/homebrew-tap`     | 20 min   |
| Smoke a `v0.0.0-rc.1` release end-to-end   | 60-90 min (mostly Apple notarization wait) |

Total: roughly **2-3 hours of focused work** if you already have an
Apple Developer account ($99/year). Add 24-48 hours of calendar wait if
you need to enroll Apple from scratch.

### 1. Apple Developer account

Required: a paid **Apple Developer Program** membership ($99/year). An
*individual* account is fine for solo maintainers; an *organization*
account is preferred if you want the team name on the certificate.

- Sign up at <https://developer.apple.com/programs/enroll/>.
- Enrollment can take **24-48 hours** (sometimes longer for org
  verification). Do this step first — everything else blocks on it.

### 2. Developer ID Application certificate

This is the cert macOS uses to verify the app was signed by you.

1. Open **Xcode** → Settings → Accounts → select your Apple ID → Manage
   Certificates → `+` → **Developer ID Application**.
   *Alternative path:* developer.apple.com → Certificates, Identifiers
   & Profiles → `+` → Developer ID Application → upload a CSR generated
   from Keychain Access.
2. Open **Keychain Access** → My Certificates → right-click the
   `Developer ID Application: <Your Name> (TEAMID)` row → **Export…**.
3. Save as a `.p12` and set a strong password. Keep both somewhere safe
   (e.g. 1Password). The password and the file both become GitHub
   secrets.
4. Note the **exact** identity string — e.g.
   `Developer ID Application: Acme Corp (ABCDE12345)`. You will paste
   this as `APPLE_SIGNING_IDENTITY`. Get it from Keychain or:
   ```bash
   security find-identity -v -p codesigning
   ```
5. Base64-encode the `.p12` for the GitHub secret:
   ```bash
   base64 -i developer-id-application.p12 -o developer-id.p12.b64
   pbcopy < developer-id.p12.b64
   ```

### 3. App Store Connect API key (for notarization)

`notarytool` (which the Tauri action calls internally) authenticates to
Apple's notarization service using an App Store Connect API key. We use
the API key flow — *not* the app-specific password flow — because it is
more reliable and does not depend on a personal Apple ID.

1. Go to <https://appstoreconnect.apple.com/access/integrations/api>
   (you may need to switch tabs to **Users and Access** → **Keys**).
2. Click `+` → **Generate API Key**.
   - Name: `Animus Desktop Notarization`.
   - Access: **Developer** is sufficient for notarization.
3. Download the resulting `AuthKey_<KEYID>.p8`. **Apple lets you
   download this exactly once.** Stash it somewhere safe.
4. From the same page, copy:
   - **Issuer ID** (UUID at the top of the page) → `APPLE_API_ISSUER`.
   - **Key ID** (the 10-char `KEYID`) → `APPLE_API_KEY`.
5. Base64-encode the `.p8` for the GitHub secret:
   ```bash
   base64 -i AuthKey_<KEYID>.p8 -o appstore-key.p8.b64
   pbcopy < appstore-key.p8.b64
   ```
   The CI workflow decodes this and writes it to disk as
   `AuthKey_<KEYID>.p8` before invoking the Tauri action.

### 4. Tauri updater signing key

The Tauri updater plugin verifies update bundles by checking a signature
against a public key baked into the app. You generate the key pair
locally, paste the public key into `tauri.conf.json`, and add the
private key + password to GitHub secrets.

```bash
mkdir -p ~/.tauri
pnpm tauri signer generate -w ~/.tauri/animus-desktop.key
```

When prompted, **set a strong password** — this becomes the
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secret.

Outputs:

- `~/.tauri/animus-desktop.key` → private key. Contents → GitHub secret
  `TAURI_SIGNING_PRIVATE_KEY` (the entire file, multi-line, including
  header/footer lines).
- `~/.tauri/animus-desktop.key.pub` → public key. The single-line value
  goes into `src-tauri/tauri.conf.json`:

  ```jsonc
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://github.com/launchapp-dev/animus-desktop/releases/latest/download/latest.json"
      ],
      "pubkey": "PASTE_THE_CONTENTS_OF_animus-desktop.key.pub_HERE"
    }
  }
  ```

Commit the `tauri.conf.json` change. **Do not commit the private key.**
Back up `~/.tauri/animus-desktop.key` somewhere safe (1Password, hardware
key vault, etc.) — if you lose it, every shipped client stops auto-
updating until you ship a new app version with a new pubkey.

### 5. GitHub repo secrets — the eight values

Go to: `https://github.com/launchapp-dev/animus-desktop/settings/secrets/actions`
and add the following as **Repository secrets**:

| Secret name                          | Source                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `APPLE_CERTIFICATE`                  | Base64 of `developer-id-application.p12` (step 2.5)                        |
| `APPLE_CERTIFICATE_PASSWORD`         | Password you set when exporting the `.p12` (step 2.3)                      |
| `APPLE_SIGNING_IDENTITY`             | The full identity string, e.g. `Developer ID Application: Acme (ABCDE12345)` |
| `APPLE_API_ISSUER`                   | Issuer UUID from App Store Connect (step 3.4)                              |
| `APPLE_API_KEY`                      | 10-char Key ID from App Store Connect (step 3.4)                           |
| `APPLE_API_KEY_PATH`                 | Base64 of the `.p8` file (step 3.5). The workflow decodes this back to disk. |
| `TAURI_SIGNING_PRIVATE_KEY`          | Contents of `~/.tauri/animus-desktop.key`                                  |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password you set in step 4                                                 |

Optional ninth secret for the Homebrew tap PR step:

| Secret name           | Source                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `HOMEBREW_TAP_TOKEN`  | A GitHub fine-grained PAT or classic token with `repo` scope on `launchapp-dev/homebrew-tap`. If absent, the tap update step gracefully no-ops. |

> Why `APPLE_API_KEY_PATH` holds the file contents and not a path: GitHub
> Actions secrets are just strings; the workflow base64-decodes
> `APPLE_API_KEY_PATH` to `$RUNNER_TEMP/appstore-key/AuthKey_<KEYID>.p8`
> at runtime, then sets `APPLE_API_KEY_PATH` for the Tauri action to
> point at that file. The variable name matches what `tauri-action`
> expects.

### 6. Bootstrap the Homebrew tap (one-time)

The `homebrew-update.yml` workflow opens a PR against
`launchapp-dev/homebrew-tap` after every successful release. That repo
needs to exist and have an initial `Casks/animus.rb` for the bump to
land on.

```bash
# Create the tap repo on GitHub first (empty, public):
#   https://github.com/launchapp-dev/homebrew-tap
gh repo clone launchapp-dev/homebrew-tap
cd homebrew-tap
mkdir -p Casks
cp ../animus-desktop/homebrew/animus.rb.template Casks/animus.rb
# Leave the VERSION_PLACEHOLDER and SHA256_PLACEHOLDER strings as-is —
# the first release bump replaces them.
git add Casks/animus.rb
git commit -m "Add Animus cask (placeholder; auto-bumped by release pipeline)"
git push
```

If the tap repo does not exist yet, the `homebrew-update.yml` workflow
detects it (HTTP 404) and logs a no-op notice. The release itself still
publishes successfully — you just don't get the automated cask bump
until the tap is bootstrapped.

---

## Cutting a release

Once the one-time setup is done, shipping a new version is:

```bash
# 1. Bump version numbers (must match across all three).
#    - package.json -> "version"
#    - src-tauri/Cargo.toml -> [package] version
#    - src-tauri/tauri.conf.json -> "version"
git commit -am "release: v0.1.0"

# 2. Tag and push.
git tag v0.1.0
git push origin main
git push origin v0.1.0
```

GitHub Actions will then:

1. Run `.github/workflows/release.yml` on `macos-14`.
2. Install the Apple Developer ID cert into a temporary keychain.
3. Materialize the App Store Connect API key on disk.
4. Build the universal binary (`--target universal-apple-darwin`) via
   the `tauri-apps/tauri-action@v0` action.
5. Code-sign with the Developer ID identity.
6. Submit the bundle to Apple for notarization via the API key.
7. Wait for Apple, then staple the notarization ticket.
8. Publish a GitHub Release with:
   - `Animus_<version>_universal.dmg`
   - `Animus.app.tar.gz`
   - `latest.json` (signed by the Tauri updater key for the auto-updater)
9. Trigger `homebrew-update.yml`, which:
   - Downloads the `Animus.app.tar.gz` from the release
   - Computes the SHA256
   - Opens a PR against `launchapp-dev/homebrew-tap` bumping the cask

End-to-end runtime: roughly **20-40 minutes** depending on Apple
notarization queue depth. Most of that is the notarization wait.

### Pre-flight checklist before tagging

- [ ] Versions match in `package.json`, `src-tauri/Cargo.toml`, and
      `src-tauri/tauri.conf.json`.
- [ ] `CHANGELOG.md` updated (if you keep one).
- [ ] You are on `main` and the working tree is clean.
- [ ] The eight Apple/Tauri secrets are still present in
      `Settings → Secrets and variables → Actions`.
- [ ] You have done a local `pnpm tauri build` at least once to confirm
      Rust compiles cleanly. (Notarization will not save you from a Rust
      error.)

### Cutting a pre-release / RC

For test builds, use a pre-release tag (`v0.1.0-rc.1`, `v0.1.0-beta.2`).
The pipeline currently treats every `v*` tag the same and publishes a
real release; if you want RCs to be hidden from the Homebrew tap, gate
the homebrew workflow on `!contains(github.event.workflow_run.head_branch, '-')`.

---

## How users install Animus

Two routes — both end in a fully signed, notarized, auto-updating app.

### Homebrew Cask (recommended)

```bash
brew install --cask launchapp-dev/tap/animus
```

This pulls the latest cask from `launchapp-dev/homebrew-tap`, downloads
the signed `Animus.app.tar.gz` from the matching GitHub Release, and
installs it to `/Applications/Animus.app`.

To upgrade later:

```bash
brew upgrade --cask animus
```

(The app's own auto-updater will also keep it current, but the Homebrew
metadata refresh is what brew uses to detect that an upgrade is
available.)

### Direct `.dmg` download

1. Go to
   <https://github.com/launchapp-dev/animus-desktop/releases/latest>.
2. Download `Animus_<version>_universal.dmg`.
3. Open the `.dmg`, drag `Animus.app` to `/Applications`.
4. First launch: macOS verifies the signature and notarization ticket
   silently — no Gatekeeper warning should appear. If you see one, see
   [Troubleshooting](#troubleshooting).

### Auto-updates

The Tauri updater polls
`https://github.com/launchapp-dev/animus-desktop/releases/latest/download/latest.json`
at runtime (configured in `tauri.conf.json`). When a newer version is
published, the app downloads the new bundle, verifies it against the
embedded public key, and prompts the user to relaunch. The check
cadence and UX are owned by the in-app updater logic (see Agent F's
`tauri-plugin-updater` integration); the release pipeline only ensures
`latest.json` is published and signed.

---

## Verifying a release locally

Useful for debugging or for security-conscious users who don't trust
GitHub.

```bash
# Codesign verification — should print "valid on disk" and "satisfies
# its Designated Requirement".
codesign --verify --deep --strict --verbose=2 /Applications/Animus.app

# Notarization verification — should print "accepted".
spctl --assess --type execute --verbose /Applications/Animus.app

# Stapled ticket inspection.
stapler validate /Applications/Animus.app
```

---

## Troubleshooting

### "errSecInternalComponent" during signing

The temporary keychain isn't unlocked or isn't on the user keychain
search list. The workflow handles this with
`security set-key-partition-list` + `security list-keychain` — if you
see this error in CI logs, the most likely cause is a corrupt
`APPLE_CERTIFICATE` base64. Re-encode the `.p12` and re-paste the
secret.

### Notarization hangs / never returns

- Check <https://developer.apple.com/system-status/> — Apple's
  notarization service has multi-hour outages a few times a year.
- Inspect the Tauri action log for the `notarytool submit` UUID. You can
  query the status manually with:
  ```bash
  xcrun notarytool log <SUBMISSION_UUID> \
    --key /path/to/AuthKey_<KEYID>.p8 \
    --key-id <KEYID> \
    --issuer <ISSUER_UUID>
  ```
- If Apple flat-out rejected the bundle, the log contains a
  human-readable error (most common: an embedded binary or framework
  was not signed with the hardened runtime).

### "App is damaged and can't be opened" on user machines

This is macOS Gatekeeper rejecting the bundle — almost always means the
notarization ticket was not stapled. Confirm with `stapler validate`
locally. The Tauri action staples by default; if you customized the
workflow, make sure you didn't drop the staple step.

### Signing succeeds locally but fails in CI

- Confirm `APPLE_SIGNING_IDENTITY` exactly matches what
  `security find-identity` printed — including the team ID in parens.
- Confirm the cert is a **Developer ID Application** cert, not
  **Apple Distribution** or **Mac App Distribution** (those are for the
  Mac App Store, not standalone distribution).

### Homebrew bump PR not opening

- The `homebrew-update.yml` workflow gracefully no-ops if the tap repo
  is missing, the cask file is missing, or `HOMEBREW_TAP_TOKEN` is
  unset. Check the Actions log for the `::notice::` lines explaining
  which guard fired.
- If you just bootstrapped the tap, kick the workflow manually by
  pushing the same tag to a throwaway branch
  (`git push origin v0.1.0 --force` is **not** recommended — instead,
  cut a `v0.1.0-rc.2` to retest).

### Updater says "no updates" even after a new release

- `latest.json` must be present on the *latest* GitHub Release and must
  be signed by the same key whose pubkey is in `tauri.conf.json`.
- Mismatched pubkey → updater silently rejects every update. The
  shipped binaries from that point forward will need a new release to
  recover (rotating the key requires a new install).
- Check the response of:
  ```bash
  curl -sL https://github.com/launchapp-dev/animus-desktop/releases/latest/download/latest.json | jq .
  ```

### "Build succeeded but no `.dmg` in the release"

The `tauri-action` skipped DMG creation, usually because a `dmg`
target wasn't included. Confirm `bundle.targets` in `tauri.conf.json`
includes `"dmg"`.

---

## Rotation & emergencies

- **Apple cert expires** (every ~5 years): renew via Xcode, re-export,
  re-encode, replace `APPLE_CERTIFICATE` + `APPLE_CERTIFICATE_PASSWORD`
  + `APPLE_SIGNING_IDENTITY`. No client-side impact — already-shipped
  builds keep working because their stapled tickets persist.
- **App Store Connect API key compromised**: revoke at
  appstoreconnect.apple.com, generate a new one, replace `APPLE_API_KEY`,
  `APPLE_API_ISSUER`, `APPLE_API_KEY_PATH`. No client-side impact.
- **Tauri updater key compromised**: bad scenario. Generate a new key,
  ship a new release with the new pubkey baked in, then *manually
  message users on the old version* to download the new build — they
  cannot auto-update across a pubkey rotation. Treat the private key
  with the same care as a signing key.

---

## File reference

| File                                      | What it does                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `.github/workflows/release.yml`           | Tag-triggered build → sign → notarize → publish.                          |
| `.github/workflows/homebrew-update.yml`   | Post-release: opens a PR against `launchapp-dev/homebrew-tap`.            |
| `homebrew/animus.rb.template`             | Initial cask file. Copy once to the tap repo; automation updates after.   |
| `src-tauri/tauri.conf.json`               | Holds the updater endpoint + pubkey + `createUpdaterArtifacts`.           |
| `docs/DISTRIBUTION.md`                    | This file.                                                                |
