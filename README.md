# Pokéclicker Scripts — NEW

Automation, interface improvements and optional gameplay changes for [Pokéclicker](https://www.pokeclicker.com/), maintained in [Axxxxpirine/Pokeclicker-Scripts-NEW](https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW).

This is an independent fork of [ephymew/Pokeclicker-Scripts](https://github.com/ephymew/Pokeclicker-Scripts), originally developed by Ephenia and contributors. It is not an official Pokéclicker project.

**Target game version: 0.10.26.** Install only the scripts you want. Some automate normal play, while others change odds, limits, resources or progression. Export your save before installing scripts or trying gameplay overrides.

## Contents

- [Installation and updates](#installation-and-updates)
- [Script catalog](#script-catalog)
- [Feature guide](#feature-guide)
- [Settings and stopping automation](#settings-and-stopping-automation)
- [Troubleshooting](#troubleshooting)
- [Compatibility and validation](#compatibility-and-validation)
- [Development](#development)
- [Credits and licenses](#credits-and-licenses)

## Installation and updates

### Browser

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser. Zen with Tampermonkey is the browser setup tested for this fork. Other userscript managers, such as [Violentmonkey](https://violentmonkey.github.io/), have not been validated here.
2. Choose a script from the catalog below and open its **Install** link. All script installation links point to this fork.
3. Check the script name and version in your userscript manager, then install it. When replacing an upstream copy, keep only one enabled copy of that script.
4. Reload [Pokéclicker](https://www.pokeclicker.com/) after installation or an update. Controls appear beside the relevant game feature, under **Settings → Scripts**, or in the **Start Menu**, depending on the script.
5. Review the controls and enable the modes you want. Some older scripts restore their previous ON/OFF state, so check the buttons after reloading.

**Auto Navigation requires this fork's Enhanced Auto Clicker.** Install both if you want its travel and objective controls.

For updates, use your userscript manager's update check or reopen the same Install link. The scripts' download and update URLs point to this repository's `master` branch. Updating a file does not replace the code already running in an open game tab: reload the game to use it.

**Branch versions:** the catalog describes the files in the checkout you are reading. Install links always serve published `master` files, which can be older than an unmerged feature branch. To test a branch, open the linked source file on that branch and use its **Raw** view, or replace the existing entry with the local file's contents. Check the version before installing. Automatic updates still follow `master` unless you change that setting in your manager.

### Desktop client

**Scripts Desktop 3.0.0 requires Electron 45.0.0 or newer.** An old desktop executable does not become secure by replacing `app.asar`. Earlier Electron versions are refused at startup.

Use this checkout's pinned Electron launcher with [Node.js 22.12 or newer](https://nodejs.org/en/download):

```sh
git clone https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW.git
cd Pokeclicker-Scripts-NEW
npm ci
npm run start:desktop
```

Export your save before migrating, keep your existing application data folder, and import the export if the new launcher opens an empty profile. Open **Settings → Scripts**, select the scripts you want, then reload. Repository scripts start disabled unless previously selected.

See the [desktop guide](desktop/README.md) for updates, platform paths, offline use and custom scripts. The published [app.asar](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/desktop/app.asar) contains the application code, not Electron. Manual replacement is appropriate only in a client whose Electron runtime meets the requirement.

The loader checks this fork for script updates and uses cached scripts offline after the game has been downloaded. Turn off **Script auto-updates enabled** to preserve local edits. When upgrading to 3.0.0 with updates disabled, refresh the selected scripts once so they understand the new activation keys. Runtime, game and script updates are separate. Rebuild the archive after editing scripts or desktop sources in a checkout.

## Script catalog

Script names link to source files in this checkout. **Install** links load the published browser userscript. Versions are taken from each script's metadata, not from the game or desktop loader version.

### Automation and interface tools

These scripts automate actions or change the interface. Individual options can extend normal limits, such as the number of simultaneous quests. Read the feature guide before enabling them.

| Script | Version | What it does | Install |
| --- | --- | --- | --- |
| [Additional Visual Settings](additionalvisualsettings.user.js) | 3.0.2 | Hide selected battle visuals and add navigation shortcuts. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/additionalvisualsettings.user.js) |
| [Enhanced Auto Clicker](enhancedautoclicker.user.js) | 3.6.3 | Adjustable auto clicking, income rates, gym repeats and dungeon exploration. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/enhancedautoclicker.user.js) |
| [Auto Navigation](autonavigation.user.js) | 1.1.1 | Travel toward bounded objectives, tracked achievements, League cycles and collection goals. Requires Enhanced Auto Clicker. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/autonavigation.user.js) |
| [Catch Filter Fantasia](catchfilterfantasia.user.js) | 1.9.6 | Species/type capture filters, separate normal/shiny ball preferences and an optional Pokérus column. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/catchfilterfantasia.user.js) |
| [Enhanced Auto Hatchery](enhancedautohatchery.user.js) | 3.3.1 | Automatic breeding and egg hatching, filters, priority IDs, native queue filling and type efficiency. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/enhancedautohatchery.user.js) |
| [Enhanced Auto Mine](enhancedautomine.user.js) | 3.0.1 | Chisel/Hammer mining and optional sale of unlocked sellable treasures. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/enhancedautomine.user.js) |
| [Simple Auto Farmer](simpleautofarmer.user.js) | 1.9.1 | Planting, harvesting, replanting, mulching, wanderer capture, stop timer and manual mutation plans. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/simpleautofarmer.user.js) |
| [Auto Battle Frontier](autobattlefrontier.user.js) | 1.5.7 | Repeat Frontier runs using a maximum stage or attack-count limit. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/autobattlefrontier.user.js) |
| [Auto Battle Items](autobattleitems.user.js) | 1.1.5 | Use selected battle items automatically and optionally buy them at base price. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/autobattleitems.user.js) |
| [Auto Quest Completer](custom/autoquestcompleter.user.js) | 2.1.2 | Accept and claim quests, prioritize types and control refresh spending. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/autoquestcompleter.user.js) |
| [Auto Safari Zone](custom/autosafarizone.user.js) | 1.3.1 | Explore, capture and collect items. Seek New pursues visible uncaught Pokémon on land and water. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/autosafarizone.user.js) |

### Optional gameplay overrides

These scripts can change normal game rules or directly change saved progression. They are individually installable.

| Script | Version | What it does | Install |
| --- | --- | --- | --- |
| [Catch Speed Adjuster](custom/catchspeedadjuster.user.js) | 1.4.5 | Toggle zero-delay Poké Ball captures. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/catchspeedadjuster.user.js) |
| [Synthetic Shiny Synapse](custom/syntheticshinysynapse.user.js) | 1.5.5 | Configure shiny odds by source or globally, with optional Karma Mode. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/syntheticshinysynapse.user.js) |
| [Debug Cheats Tools](custom/debugcheatstools.user.js) | 1.1.2 | Manual inventory, currency, Pokémon and quest-line editing. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/debugcheatstools.user.js) |
| [Optional Resources](custom/optionalresources.user.js) | 1.0.1 | Explicit resource grants and a bounded online Dream Orb bonus. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/optionalresources.user.js) |
| [Optional Battle Cafe](custom/optionalbattlecafe.user.js) | 1.0.1 | Accelerated, bounded Café batches, reward-time overrides and extra spins. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/optionalbattlecafe.user.js) |
| [Optional Accelerators](custom/optionalaccelerators.user.js) | 1.0.1 | Farm speed, a hatch EV bonus and double route party-attack cadence. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/optionalaccelerators.user.js) |
| [Omega Protein Gains](custom/omegaproteingains.user.js) | 1.2.2 | Optional Protein/Calcium cap overrides. Carbos remains capped at 70. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/omegaproteingains.user.js) |
| [Challenge Mode Changer](custom/challengemodechanger.user.js) | 1.2.5 | Enable or disable challenges on an existing save. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/challengemodechanger.user.js) |
| [Discord Code Generator](custom/discordcodegenerator.user.js) | 1.3.5 | Generate codes for Discord reward Pokémon without linking a Discord account. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/discordcodegenerator.user.js) |
| [Infinite Seasonal Events](custom/infiniteseasonalevents.user.js) | 1.3.5 | Toggle seasonal events outside their normal dates, including simultaneous events. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/infiniteseasonalevents.user.js) |
| [Oak Items Unlimited](custom/oakitemsunlimited.user.js) | 1.0.5 | Remove the limit on simultaneously equipped Oak Items. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/oakitemsunlimited.user.js) |
| [Overnight Berries](custom/overnightberrygrowth.user.js) | 1.1.6 | Apply offline berry growth with ripe, withered or pre-wither harvest modes. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/overnightberrygrowth.user.js) |
| [Perky Pokerus Pandemic](custom/perkypokeruspandemic.user.js) | 2.0.5 | Spread Pokérus between eligible hatchery eggs without matching types. Helper eggs are excluded. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/perkypokeruspandemic.user.js) |
| [Simple Weather Changer](custom/simpleweatherchanger.user.js) | 1.4.5 | Override weather across regions, or return to Default Weather. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/simpleweatherchanger.user.js) |

### Repair tool

| Script | Version | What it does | Install |
| --- | --- | --- | --- |
| [Script Fixer Upper](scriptfixerupper.user.js) | 2.2.3 | Reset known script preferences after confirmation, preserving saves and unrelated data. Use only for troubleshooting. | [Install](https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/scriptfixerupper.user.js) |

## Feature guide

### Auto Safari Zone

Open a Safari and turn **Auto Safari ON**. To look for species you do not own, also turn **Auto Seek New ON**. Normal species ownership is used for Seek New, not whether you own its shiny form.

With Seek New enabled, movement follows this order:

1. Pursue visible shiny Pokémon first.
2. If **Auto Pick Items** is ON and only one Safari Ball remains, collect reachable items before spending that last ball.
3. Pursue the nearest reachable visible uncaught Pokémon, on land or in water. Distance is measured along a walkable path, including detours around obstacles.
4. If no visible uncaught target is reachable, return to random encounters in the preferred habitat.

Visible uncaught targets are checked again each movement tick. If a target moves, disappears or has been caught, the route is recalculated. Unreachable targets do not prevent the script from pursuing another reachable target or returning to random encounters.

**Grass or water?** For random encounters, Seek New compares currently available missing species in both habitats. If one habitat's missing-species pool contains the other's plus additional species, it prefers that habitat. Otherwise, it compares the weighted chance of encountering a missing species. Equal chances allow either habitat, using the closest reachable encounter tile. **Seek PKRS** also contributes contagious Pokémon to this habitat selection when enabled. It does not switch habitats on a fixed timer.

| Control | Behavior |
| --- | --- |
| Auto Safari | Starts exploration and battles. Can pay for another entry and repeat while access and funds permit. |
| Auto Pick Items | Collects items when one ball remains. Enabled by default. |
| Auto Throw Bait | Uses berry bait for priority encounters when reserves permit, or ordinary bait toward the bait achievement. |
| Auto Seek New | Pursues visible uncaught species and favors habitats containing missing species. |
| Auto Seek PKRS | Prioritizes Pokémon your party currently marks as contagious. |
| Auto Fast Anim | Halves the cached movement and battle animation timings. |

During a visible uncaught pursuit, the script attempts to capture an uncaught encounter instead of fleeing it. Already-caught interruptions are skipped unless another enabled priority, such as Seek PKRS, applies. Shiny battles have their own capture strategy and may use bait even with Auto Throw Bait OFF. Berry bait requires more than 25 of the relevant berry for ordinary priority encounters, or more than 5 for shiny encounters.

**Stopping:** the first click on an active Auto Safari button requests a stop after the current Safari ends. Its button turns amber. A second click stops automation immediately. A game action already underway may still finish.

**Limits:** Seek New does not stop automatically when every currently available species is caught. It then falls back to ordinary encounters. It does not change regions, unlock unavailable species or guarantee a successful catch. Safari entry fees are not covered by Auto Navigation's budgets.

### Enhanced Auto Clicker and Auto Navigation

Enhanced Auto Clicker adds **Auto Click**, an attack-rate control, **Auto Gym** and **Auto Dungeon**. Dungeon options control exploration, fights and chest targeting. Actual throughput depends on the game and capture delays.

While Auto Click is ON, its statistics panel also shows **Money/s** and **Dungeon tokens/s**. These are gross earnings from all sources recorded by the game, so purchases and dungeon entry costs do not reduce them. Values update once per second and average the last ten samples (normally ten seconds), using actual elapsed time. The window resets when changing locations, restarting Auto Click or changing its statistics display settings. With Auto Click OFF, the values show a dash.

Auto Navigation adds a separate panel above the battle view. Install both scripts, select an **Objective**, set its limits and press **Start** from a route or town.

| Objective | Target and behavior |
| --- | --- |
| Route defeats, Gym wins, Dungeon clears | Target count is the lifetime total to reach at each eligible location. |
| Current dungeon: additional clears | Counts new wins from this start. |
| Capture species or roaming species | Enter the exact numeric species ID. Uses accessible locations and existing capture settings. |
| Route or dungeon Pokérus resistance | Works on currently obtainable contagious Pokémon. |
| Active location quests | Supports Pokémon-defeat, gym-defeat and dungeon-defeat quests already active. Does not accept or claim quests. |
| Complete currently tracked achievement | Select a native route, gym or dungeon achievement first. Stops at its selected tier. |
| Current League: additional cycles | Start in a League town. Target count is additional complete cycles, up to 10,000. |
| Current zone: capture all available Pokémon or shiny | Start on a route or in a dungeon town. Target count caps additional route defeats or dungeon entries, including losses. |
| Buy to stock target | Buys listed consumables only at base price and within the configured budget. Start from a route so battling can lower inflated prices. |
| Visit Battle Frontier | Travels to the unlocked Frontier town without starting a Frontier run. |
| Purify Shadow Pokémon | Uses native flow requirements and resets flow normally. Target count caps purifications. |

**Money and dungeon-token budgets default to zero.** Set a budget and any desired reserve before paid entries or purchases. Budgets cover that navigation session only, not manual actions or other scripts. Session and no-progress time limits also apply to collection searches. They do not guarantee a shiny, and route totals may overshoot slightly between checks. Headbutt-only encounters are excluded from route searches.

**Stop & return** restores the starting location and previous clicker modes where possible. Manual travel or a manual clicker toggle cancels without returning. Active navigation sessions never resume after reload. Do not run old Walker or autoAchievement prototypes alongside this controller.

### Enhanced Auto Hatchery

Open the Hatchery and enable **Auto Hatch**. Its controls include store-bought eggs, Pokérus handling, hatchery filters and a rotating list of priority species IDs.

- **Filter Only** restricts selection to Pokémon matching the native hatchery filters.
- **Priority IDs** are validated and rotated rather than continually selecting the first entry.
- **Auto Queue** appends eligible Pokémon to the native queue, preserving existing order and avoiding duplicate entries. Its target is 1–100, bounded by your unlocked queue capacity. Requires Auto Hatch and pauses while PKRS Mode or Auto Egg is ON.
- Turning Auto Queue OFF or changing filters does not remove entries already queued.
- **Type efficiency** ranks eligible candidates by native breeding efficiency, regional multiplier and attack effectiveness against the selected target types. Pokérus and priority rotation still take precedence.

**Auto Fossil and Shiny Fossils are disabled for game 0.10.26.** Fossils now use the game's town traders rather than the removed hatchery incubation system.

### Simple Auto Farmer

Open the Farm to access the controls. Enabled modes continue working while the Farm window is closed.

| Mode | Behavior |
| --- | --- |
| Auto Plant | Plants the selected berry. |
| Auto Harvest | Harvests ripe berries. |
| Auto Replant | Harvests shortly before withering and replants the same berry. Mutually exclusive with Auto Plant and Auto Harvest. |
| Auto Mulch | Renews the existing mulch near expiry. |
| Auto Catch | Handles wanderers using native capture rules and ball settings, before harvesting. |
| Mutation plan | Uses a manual 5×5 berry layout and reserves. Leaves occupied, locked and unassigned plots untouched. Turns Plant, Harvest and Replant OFF. |
| Rich Mulch | Adds one unit to an eligible unmulched plant shortly before maturity, subject to a reserve and per-activation cap. Mutually exclusive with Auto Mulch. |

The mutation plan arranges parent berries and empty spaces you choose. It does not design mutations for you or uproot existing plants. Farmhands remain independent.

The **stop timer** accepts 1–10080 whole minutes. Starting it does not enable modes. Its deadline survives reloads and stops farm automation when reached, or at the next check after the tab wakes. Cancelling the timer leaves active modes unchanged. Mutation plan and Rich Mulch activation both start OFF after reload.

### Enhanced Auto Mine

Open the Underground and turn **Auto Mine ON**. It takes at most one action per second using Chisel or Hammer as durability permits. Enable the game's **Auto Restart** to continue to the next mine.

**Auto Sell Treasure** sells the current stock of sellable, unlocked underground items after a layer is completed. Lock items you want to keep. Bombs are avoided. Old energy restores, survey/skip controls and the separate plate-selling mode are no longer part of this script.

### Catch Filter Fantasia and Auto Quest Completer

**Catch Filter:** open **Filter** under Poké Balls. Green species entries are eligible for capture. Enabled type filters also allow matching Pokémon. Set separate normal and shiny ball preferences per species, or leave them at the game's defaults. Right-click a ball preference to clear it. The optional Pokérus column helps inspect infection status. Capture-oriented automation still depends on your ball settings and stock.

**Auto Quests:** use **Auto** and the reset-timer button in the quest panel. Configure maximum active quests, preferred types, refresh interval, paid-refresh budget and money reserve under **Settings → Scripts**. The default paid-refresh budget is zero, allowing free refreshes only. Turning Auto OFF stops its reset timer. Spending resets on a new Auto session or reload. This budget is independent of Auto Navigation's budgets.

### Optional gameplay changes

These tools change gameplay or saved progression. Turning an effect OFF stops future changes but does not undo resources, Pokémon, EVs or achievements already gained.

| Script | Controls and limits |
| --- | --- |
| Synthetic Shiny Synapse | Open **Start Menu → Shiny Modifier**. Set category-specific odds, a global override, or Karma Mode. Odds are denominators: smaller values mean more frequent shiny rolls. Native shiny bonuses are preserved. |
| Debug Cheats Tools | Open **Start Menu → Debug Cheats** for manual currency, inventory, Pokémon and quest-line actions. Currency Add grants the exact amount, Subtract stops at zero, and Repair applies only to invalid balances. Inventory grants are limited to 1,000,000 per click. |
| Optional Resources | Enable its controls before making explicit grants of currencies, items, berries, Dream Orbs or purification flow. Flow respects the native cap and unlock. The Dream Orb bonus grants one random unlocked orb per observed visible hour, stopping after your chosen total of 1–100 orbs. Hidden/suspended time and offline catch-up do not count. Stop or reload discards partial time. |
| Optional Battle Cafe | In the Café, select a sweet, recipe, reward time and a batch of 1–100. Accelerated results resolve every 0.1 seconds, including the hour-long recipe. Native berry costs and spin rules still apply. Unlock requirements, insufficient resources or an existing native spin prevent a batch. Extra spins are a separate manual grant. The reward-time override does not change the game clock. |
| Optional Accelerators | Under **Settings → Scripts**, set farm speed to 0.5×, 2×, 5× or 10×, add one base EV per successful hatch through native eligibility rules, or enable 2× route party-attack cadence. Farm speed also affects withering, mutations and farmhands. Offline growth keeps its own timing. The attack toggle does not accelerate gyms, dungeons or the Frontier. |
| Omega Protein Gains | Under **Settings → Scripts**, enable a personal Protein/Calcium ceiling or explicitly choose unlimited mode. Consumes actual vitamin stock and respects challenge/hatchery restrictions. Carbos remains capped at 70. Lowering the ceiling does not remove vitamins already used. |
| Overnight Berries | Under **Settings → Scripts**, select offline growth until ripe, until withered, or harvest before withering. This is separate from online farm acceleration. |

Optional Resources, Optional Battle Cafe, Optional Accelerators and Omega Protein Gains activation start OFF after reload. Other custom scripts can apply changes as soon as they load or restore saved preferences. Check their settings individually.

## Settings and stopping automation

- Browser script settings generally use local storage for the game site. A different browser profile or origin has separate settings and saves.
- Installing a script and activating an individual mode are separate steps for scripts with ON/OFF controls. Some scripts apply their effect directly when enabled in the manager.
- To unload a script, disable it in your userscript manager or desktop **Settings → Scripts**, then reload the game. Disabling an entry alone does not remove code already running in the current page.
- Reload behavior is script-specific. Auto Safari, navigation sessions and the newer optional overrides start OFF. Some older automation modes restore their saved state.
- Preserve a save export when testing overrides. Removing a script does not roll back changes already saved by the game.

## Troubleshooting

**A button is missing or an update has no effect**

Check that the script is enabled, reload the game, then open the relevant game feature. Confirm the installed version and repository. If you are viewing a feature branch, a master Install link may still serve an older version.

**Duplicate controls, unexpected behavior or a script-loading warning**

Keep one enabled copy of each script, including upstream copies and copies installed under another name. Disable the suspected script and reload. If needed, reproduce with only that script and its required dependencies enabled.

**Captures or objectives are not progressing**

Check feature unlocks, Poké Ball stock, capture filters, budgets, reserves and session limits. Auto Navigation does not bypass native access checks. Auto Safari continues ordinary encounters when no missing species is currently available, and requires another entry fee when it starts a new Safari.

**Mining waits or old fossil controls do nothing**

Mining waits for durability and relies on the game's Auto Restart. Energy restores and layer skipping were removed. Use town traders for fossils.

**Last resort: reset script settings**

Script Fixer Upper is a troubleshooting tool, not a normal dependency. After confirmation it resets only a fixed list of known preferences for this collection. It preserves saves, backups, unknown keys, other scripts’ data, activation choices and update preferences, then disables itself. Export your save first. Prefer disabling the problematic script before resetting its preferences.

**Report a problem**

Open an [issue in this fork](https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/issues). Include the game version, script names and versions, browser/OS or desktop runtime, enabled options, reproduction steps, and any console error. Report script problems here rather than to the Pokéclicker game team.

## Compatibility and validation

This fork targets **Pokéclicker 0.10.26**. Browser testing previously used **Zen 1.23.4b with Tampermonkey 5.5.0**. Desktop 3.0.0 was exercised with **Electron 45.0.0 on macOS**, using the real game in an isolated test profile. Other userscript managers, every script combination and all game regions have not been exercised.

The 334-test automated suite covers Safari pathfinding and capture priorities, mining, farming, hatchery queues, navigation limits, quest budgets, custom overrides, desktop loading and updates, security regressions and archive/source consistency. [GitHub checks](https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/actions/workflows/security.yml) run the suite and dependency audits on macOS, Windows and Linux. These checks do not substitute for native Windows/Linux gameplay testing.

Safari movement, bait, captures, item collection and stopping were checked in a live Kanto session with version 1.2.5. The visible-uncaught pursuit introduced in **Auto Safari 1.3.0** is covered by automated tests and code review. Version 1.3.1 additionally updates Desktop activation handling. The new pursuit has not been exercised in a live session.

### Security review — 2026-10-27

The review covered all 26 userscripts, the desktop loader and updater, Electron settings, dependency lockfiles and shipped package contents, build automation, repository history and GitHub security settings. No credential-pattern matches were identified in the history scan. Shipped dependency files were compared with their locked npm distributions. Both npm dependency audits reported zero known vulnerabilities at review time.

Desktop 3.0.0 adds explicit renderer isolation, sandboxing, local-file restrictions, denied permissions, navigation and popup controls, and a content security policy. Script downloads are restricted to this fork, bounded in size and checked against GitHub's reported blob hash. Game archives receive bounded downloads, path/type/size validation and staged installation with rollback on ordinary failure. Script activation keys no longer collide with game storage, and Script Fixer Upper no longer clears unrelated data. The obsolete container build was removed and CI actions are pinned by commit.

Native macOS checks covered real game download and startup, offline reload, renderer isolation, blocked private-file access, popup/navigation restrictions and denied permissions. Security regressions were also independently reviewed. See the [desktop guide](desktop/README.md#security-boundaries) for remaining trust boundaries and recovery limits. This is a source and runtime review with regression testing, not an independent certification or a guarantee that no vulnerability remains.

## Development

With Node.js 22.12 or newer, from the repository root:

```sh
npm ci
npm test
```

To package the desktop loader with the scripts and license notices from your current checkout:

```sh
npm run build:desktop
```

Desktop dependencies are pinned in `desktop/app_src/package-lock.json` and bundled for offline installation. To reinstall them from the lockfile, run `npm run deps:desktop`, then rebuild and test. This excludes optional native fallbacks and package lifecycle scripts. Discord uses Electron's native protocol registration. Check the shipped npm dependencies with `npm audit --prefix desktop/app_src --omit=optional`.

This rebuilds `desktop/app.asar` from `desktop/app_src`, the root/custom userscripts and `LICENSE`. Rebuild after changing bundled scripts, desktop sources or notices. The packaging test rejects an archive that no longer matches these files. The [desktop guide](desktop/README.md) describes the loader and update behavior.

When changing a script, update its metadata version and this catalog, document user-visible behavior, and add focused regression coverage for behavior changes. Keep download/update URLs on this fork. A local edit or test run does not publish a release to `master` or update an already-running browser tab.

## Credits and licenses

The userscript collection is licensed under [GNU GPL v3](LICENSE). Original authorship and license headers are retained, and modifications to inherited userscripts carry dated fork notices. This permission covers the scripts, not ownership of Pokémon names, artwork or other third-party material.

The original collection was developed by **Ephenia** and contributors and is available at [ephymew/Pokeclicker-Scripts](https://github.com/ephymew/Pokeclicker-Scripts). Script-specific credits include **Optimatum / umbralOptimatum, Ivan Lay, Drak, KarmaAlex, Pastaficionado, Kanzen01, kevingrillet**, and the other authors named in those headers. Fork additions and adaptations are maintained by **Axxxxpirine**. Ideas credited in the source include navigation work by **goldhaxx, Bowbylone / Dionisos94 and Sorrow**, wanderer capture by **CatapultingWizard**, and the Dream Orb proposal by **EasyGoinGaming**.

The desktop integration builds on [Pokéclicker Desktop](https://github.com/RedSparr0w/Pokeclicker-desktop), whose package declares **ISC** and credits **RedSparr0w**. The bundled userscripts remain GPL-3.0, and dependencies retain their own licenses. The archive includes the full GPL text and [component notices](desktop/app_src/NOTICES.md). Its editable sources are in [desktop/app_src](desktop/app_src), with the [build script](scripts/build-desktop.cjs) provided in this repository. These notices describe component origins and do not relicense third-party code.

Pokéclicker and its contributors maintain the game itself. Attribution links are provided for credit, while script installation and issue-report links point to this fork.
