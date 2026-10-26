# Pokéclicker Scripts Desktop

A modified Pokéclicker desktop client that manages userscripts. This fork's **Scripts Desktop 2.2.2** includes the scripts from the same checkout as the archive. It checks **Axxxxpirine/Pokeclicker-Scripts-NEW**, not the upstream scripts repository, for script updates.

## Install or update

1. Export your save from the game's Save menu and keep the original client `app.asar`. Keep the application data folder as well. Replacing the archive does not require deleting or resetting this folder.
2. Close the desktop client, locate its `resources` folder (inside the application bundle on macOS), and replace `app.asar` with the file from this folder and branch.
3. Start the client and open Settings → Scripts. Repository scripts start disabled unless you already selected them. Enable the scripts you want, then restart or reload the window.

This archive contains the modified client JavaScript, not the Electron executable. Its base package version is 1.2.0. The loader was exercised on macOS with **Electron 21.3.1 and game 0.10.26**, using an isolated profile and copied save. Other Electron/client versions and Windows/Linux require their own validation. Obtain the official client separately from [Pokéclicker Desktop releases](https://github.com/RedSparr0w/Pokeclicker-desktop/releases/).

## Versions and updates

Settings → Scripts shows the game version, Scripts Desktop version, Electron runtime and modified package version separately. The installed official client version is reported as **unknown** because replacing `app.asar` also replaces its `package.json`. The modified package version must not be used to identify the original client.

Automatic executable updates are disabled in the modified client because their version comparison would use the replaced package metadata. Check official client releases manually. Script updates remain available, and a newer Scripts Desktop version is reported in the Scripts panel using the repository's update-check metadata. Game data updates retain the original client's updater.

The script updater validates downloaded JavaScript, replaces complete files atomically and retains the cached copy after network or write failures. An older numbered script version cannot replace a newer installed version. Files absent from a remote listing are retained, rather than renamed or deleted.

Turn off **Script auto-updates enabled** to preserve local edits. A missing checksum does not override that choice. New scripts can still be installed, disabled by default. **Update scripts on next game launch** requests one update pass and is only cleared after a successful pass. Failed/offline checks preserve the request. A request made while an earlier check is running remains queued for the next launch.

## Offline use and paths

The game must have been downloaded at least once. After that, the cached game and scripts work offline. The archive bundles 26 repository scripts, so missing script files can also be initialized without a network connection. Bundled newer versions update existing files only when script updates are enabled. Existing selections remain unchanged.

The application data location normally is:

- Windows: `%appdata%/pokeclicker-desktop` or `%localappdata%/pokeclicker-desktop`
- macOS: `~/Library/Application Support/pokeclicker-desktop`
- Linux: `$XDG_CONFIG_HOME/pokeclicker-desktop` or `~/.config/pokeclicker-desktop`

The exact directory is printed in the main-process log. It contains `scripts`, `custom-scripts`, `settings.ini` and the client's game/save storage. Game paths use native file loading, including spaces, accents and `#` characters. Successful save exports remember their destination directory in `settings.ini` for the next session. Cancelled exports do not replace it. A directory that no longer exists falls back to the native save dialog's default.

## User-added scripts and multiple windows

Put additional `.js` files in `custom-scripts`. They default to enabled. Their existing first-dot toggle keys are migrated to separate `desktopUserScript:<filename>` keys on first use, preserving explicit disabled states. Each custom file then has its own toggle, even if its name overlaps a downloaded script. Each script runs in a separate function scope so top-level `const` declarations cannot collide.

Each window loads the scripts once per document. A failing script does not stop the following scripts or prevent the game from starting. A reload invalidates pending injection into the old document. Shared cache updates are serialized across windows. The client's native save-slot behavior is unchanged: use different saves in concurrent windows to avoid competing game saves.

An initialization error inside a userscript can still be reported by that script after the loader finishes. Loader checks do not establish that every script feature works in every game context. Disabling a script and reloading is preferable to deleting application data or running Script Fixer Upper indiscriminately.

## Build and checks

From the repository root:

```sh
npm ci
npm test
npm run build:desktop
```

The build copies `desktop/app_src` into `.local/desktop-build`, adds the current root/custom userscripts and packages `desktop/app.asar` with the pinned `@electron/asar` dependency. Do not edit the generated archive directly. The checked-in archive must be rebuilt after changing desktop sources or bundled scripts.

Automated tests cover malformed settings, offline fallback, failed updates, disabled updates, downgrades, script isolation, stale navigation, update-request timing, custom-toggle migration and remembered exports. The Electron smoke test additionally exercised the packaged archive, a copied 0.10.26 save, reload, a secondary window, an accented data path and a native export. It does not certify every script or every region of the game.

## Licenses and provenance

The userscripts retain their original credits and GPL-3.0 notices. The build includes the repository's full `LICENSE` as `LICENSE-GPL-3.0.txt` in `app.asar`, alongside [component notices](app_src/NOTICES.md). The upstream desktop package declares ISC and credits RedSparr0w. Dependencies retain their individual license files.

Fork modifications and packaging were updated on 2026-10-27 by Axxxxpirine. Editable desktop sources are in [app_src](app_src), userscripts are in the repository root and `custom`, and [the build script](../scripts/build-desktop.cjs) reproduces the archive. Use sources from the same repository revision as the archive.

## Dependency maintenance

Desktop 2.2.2 pins its production dependency tree in [package-lock.json](app_src/package-lock.json). It includes adm-zip 0.6.1 and ws 7.5.13 and removes the unused electron-updater dependency tree. The audited shipped npm packages reported no known vulnerabilities on 2026-10-27. The Electron executable is supplied by the official client and is outside this package audit.

To refresh the bundled files from the lockfile, run these commands from the repository root:

```sh
npm run deps:desktop
npm audit --prefix desktop/app_src --omit=optional
npm run build:desktop
npm test
```

The install omits optional native fallbacks and skips package lifecycle scripts. Discord protocol registration uses Electron's built-in API. Generated command launchers and npm's hidden install cache are excluded from the archive. Keep the installed dependency files, lockfile and rebuilt archive together in a change. Packaging tests check every bundled dependency file against its source and reject leftover dependencies.

The 2.2.2 archive also passed a hidden Electron 21.3.1/macOS smoke test with Node 16.16.0: ZIP extraction, offline startup, two document loads, all 26 bundled scripts discovered, and native Discord protocol registration. The test used an isolated minimal game fixture, blocked networking and suppressed Discord login. It did not change a user save or validate Windows/Linux or live Discord connectivity.
