# Pokéclicker Scripts Desktop

**Scripts Desktop 3.0.0** manages this fork's 26 userscripts and targets Pokéclicker 0.10.26. Script updates come from [Axxxxpirine/Pokeclicker-Scripts-NEW](https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW). This is an independent modification of RedSparr0w's desktop client.

## Install or update

**Electron 45.0.0 or newer is required.** Replacing `app.asar` updates application code but cannot upgrade Electron, Chromium or Node inside an old executable. This release refuses older Electron runtimes. Use the pinned launcher below instead of installing the archive in an obsolete official client.

1. Export your save from the game's Save menu. Keep your previous client and application data folder.
2. Install [Node.js 22.12 or newer](https://nodejs.org/en/download) and [Git](https://git-scm.com/downloads), then run:

```sh
git clone https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW.git
cd Pokeclicker-Scripts-NEW
npm ci
npm run start:desktop
```

3. Import the exported save if the launcher opens an empty profile. Open **Settings → Scripts**, select the scripts you want, then reload. Repository scripts default to disabled. Existing explicit choices are preserved.

`npm ci` installs the pinned Electron runtime, including its normal binary download. To update an unmodified checkout, close the game, run `git pull --ff-only`, then `npm ci` and `npm run start:desktop`. Runtime upgrades require an updated lockfile and reinstall. The launcher does not silently upgrade its own executable.

The [published app.asar](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/desktop/app.asar) remains available for manual installation in a compatible client. Keep its original archive, close the client and replace `resources/app.asar` only after checking its Electron version. On macOS, resources are inside the application bundle. Do not delete application data to update.

## Versions and updates

Settings → Scripts shows the game, Scripts Desktop, Electron runtime and modified package versions separately. The inherited package metadata is 1.2.0. It does not identify the original installed client, which is reported as unknown. Scripts Desktop is 3.0.0.

Script updates validate the repository listing, exact download location, Git blob hash, JavaScript and numbered version. Downloads are limited to 4 MiB per script. A failed download or write retains the cached script. An older numbered version cannot replace a newer installed version. Files missing from a remote listing are retained.

Turn off **Script auto-updates enabled** to preserve local edits. A missing checksum does not override that choice. New scripts can still be installed, disabled by default. **Update scripts on next game launch** requests one update pass and is cleared only after success. Offline checks and a request made during an earlier check preserve the pending request.

Repository activation choices use `desktopEpheniaScript:<name>`. Existing boolean choices are read without rewriting bare game-storage keys. **When upgrading to 3.0.0 with updates disabled, back up local script edits and request one update pass, or manually replace selected files with the current versions.** Old cached scripts may still read legacy activation keys and ignore a changed selection.

Game updates come from the official Pokéclicker repository. Downloads reject redirects, HTTP errors, incomplete responses and excessive size. The updater validates paths, file types, collisions and extracted sizes, requires game metadata and an HTML index, applies the security policy, then promotes the staged game. Ordinary installation failures restore the prior game. Saves are outside the replaced game directory.

## Offline use and paths

After the first successful game download, cached game files and scripts work offline. The archive includes all 26 repository scripts. Bundled newer versions replace existing files only when script updates are enabled. Existing activation choices are retained.

The application data location normally is:

- Windows: `%appdata%/pokeclicker-desktop` or `%localappdata%/pokeclicker-desktop`
- macOS: `~/Library/Application Support/pokeclicker-desktop`
- Linux: `$XDG_CONFIG_HOME/pokeclicker-desktop` or `~/.config/pokeclicker-desktop`

The exact directory is printed in the main-process log. It contains `scripts`, `custom-scripts`, `settings.ini`, cached game files and Chromium's save storage. Back up the whole directory while the client is closed. A launcher or platform change may use another profile, so retain an exported save as well.

Game paths use native file loading, including spaces, accents and `#`. Successful save exports remember their directory in `settings.ini`. Cancelled exports do not replace it. Missing directories fall back to the native save dialog's default.

## User-added scripts and multiple windows

Put trusted additional `.js` files in `custom-scripts`. They default to enabled. Legacy first-dot choices migrate to separate `desktopUserScript:<filename>` keys without changing unrelated game storage. Each file has its own toggle and function scope. Symbolic links in script locations are rejected.

Each window loads scripts once per document. One failing script does not prevent subsequent scripts or the game from starting. Reloading invalidates pending injection into the old document. Cache updates are serialized across windows. Use separate save slots in concurrent windows to avoid competing saves.

A userscript can report its own initialization failure after the loader completes. Disable the affected script and reload before attempting broader resets. Script Fixer Upper resets only this collection's known preferences and preserves unknown keys, saves, backups and activation/update choices. It disables itself after confirmation.

## Security boundaries

The review on 2026-10-27 covered first-party sources, shipped dependencies, build automation, repository history and GitHub settings. Dependency audits returned zero known vulnerabilities. Dependency files were compared with their locked npm tarballs. Secret scanning, push protection and vulnerability alerts are enabled on this fork. Automated checks run on pull requests and pushes to `master`.

The renderer has no Node integration, uses context isolation and Chromium's sandbox, keeps web security enabled, denies permissions and webviews, and blocks unapproved navigation, popups and local-file access. Selected HTTPS help destinations open in the system browser. Discord activity fields are bounded before being passed to the native integration. The initial setup page no longer loads analytics.

The content security policy disallows remote JavaScript, frames, plug-ins and form submissions. It retains inline JavaScript and `eval` for the game's inline handlers and Knockout bindings. This is not protection against every script injection inside the game. Enabled userscripts and the downloaded game remain trusted code with access to game saves. Custom scripts can change or delete game data.

HTTPS and Git blob checks detect wrong locations, truncated content and mismatches with the listing. They do not authenticate a release independently of GitHub or protect against a compromised trusted publisher. The game follows the official repository's `master` archive, not a separately signed release. Keep Electron and dependencies maintained after this review.

Installation uses two directory renames. A process crash or power failure between them can leave the old game in `.pokeclicker-update-*/previous` without an active game directory. An ordinary error rolls back automatically, but crash recovery is not transactional. Keep any retained recovery directory, close the client and restore its `previous` directory to `pokeclicker-master` if needed. Save storage is separate. Local malware running as the same OS user and concurrent filesystem tampering are outside this review's protection model.

Native macOS testing used Electron 45.0.0 and the real game 0.10.26 in an isolated profile. It checked startup, offline reload, file-access restrictions, navigation/popups, denied permissions and renderer isolation. Earlier native checks exercised save export and multiple windows, but these do not establish every combination on the new runtime. Windows/Linux GUI behavior, live Discord connectivity and Discord account-linking flows remain unverified. Browser redirects and embedded login flows may be blocked by the navigation policy.

## Build and checks

From the repository root, with Node.js 22.12 or newer:

```sh
npm ci
npm test
npm run build:desktop
npm test
npm audit
npm audit --prefix desktop/app_src --omit=optional
```

The build copies `desktop/app_src` into `.local/desktop-build`, adds current userscripts and packages `desktop/app.asar` with pinned `@electron/asar`. Rebuild after source or bundled-script changes. Tests compare archive contents with sources and notices. GitHub checks also rebuild the archive and check reproducibility on Linux.

Production dependencies are pinned in [package-lock.json](app_src/package-lock.json) and tracked for offline packaging. To restore them, run `npm run deps:desktop`, then rebuild and test. This install omits optional native fallbacks and skips lifecycle scripts. Discord protocol registration uses Electron's built-in API. Generated command launchers and npm's hidden install cache are excluded from the archive.

## Licenses and provenance

Userscripts retain original credits and GPL-3.0 notices. The archive includes the repository's full license as `LICENSE-GPL-3.0.txt`, alongside [component notices](app_src/NOTICES.md). The upstream desktop package declares ISC and credits RedSparr0w. Dependencies retain individual license files. These notices do not relicense third-party components.

Fork modifications and packaging were updated on 2026-10-27 by Axxxxpirine. Editable sources are in [app_src](app_src), the repository root and `custom`. The [build script](../scripts/build-desktop.cjs) reproduces the archive. Use sources from the same revision as the archive.
