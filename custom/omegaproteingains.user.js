// ==UserScript==
// @name          [Pokeclicker] Omega Protein Gains
// @namespace     Pokeclicker Scripts
// @author        Ephenia
// @description   Opt-in vitamin cap override with a personal Protein/Calcium ceiling or explicit unlimited mode. Starts OFF and keeps Carbos capped at 70.
// @copyright     https://github.com/Ephenia
// @license       GPL-3.0 License
// @version       1.2.0

// @homepageURL   https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/
// @supportURL    https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/issues
// @downloadURL   https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/codex/l5-custom-options/custom/omegaproteingains.user.js
// @updateURL     https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/codex/l5-custom-options/custom/omegaproteingains.user.js

// @match         https://www.pokeclicker.com/
// @icon          https://www.google.com/s2/favicons?domain=pokeclicker.com
// @grant         unsafeWindow
// @run-at        document-idle
// ==/UserScript==

function initOmegaProtein() {
    // Reinitialization restores the native behavior instead of stacking overrides.
    if (window.omegaProteinSettings) {
        window.omegaProteinSettings.setEnabled(false);
        window.omegaProteinSettings.setUnlimited(false);
        return;
    }
    const originalUseVitamin = PartyPokemon.prototype.useVitamin;
    const validCount = value => Number.isSafeInteger(value) && value >= 0;
    let enabled = false;
    let unlimited = false;
    let cap = 1000;
    try {
        const saved = JSON.parse(localStorage.getItem('omegaProteinCap'));
        if (validCount(saved)) cap = saved;
    } catch (_) { /* Invalid saved settings use the finite default. */ }

    function useVitamin(vitamin, amount) {
        // A later userscript may retain this wrapper after we switch OFF.
        if (!enabled) return originalUseVitamin.apply(this, arguments);
        const types = GameConstants.VitaminType;
        if (![types.Protein, types.Calcium, types.Carbos].includes(vitamin)
            || !Number.isSafeInteger(vitamin) || (amount !== Infinity && !validCount(amount)) || amount === 0) return;
        if (App.game.challenges.list.disableVitamins.active()) {
            Notifier.notify({
                title: 'Challenge Mode', message: 'Vitamins are disabled',
                type: NotificationConstants.NotificationOption.danger,
            });
            return;
        }
        if (this.breeding) {
            Notifier.notify({
                message: 'Vitamins cannot be modified for Pokémon in the hatchery or queue.',
                type: NotificationConstants.NotificationOption.warning,
            });
            return;
        }
        const used = this.vitaminsUsed[vitamin]();
        const stock = player.itemList[types[vitamin]]();
        if (!validCount(used) || !validCount(stock)) return;
        // Infinity is the native Max-button sentinel. Clamp it to finite stock and
        // capacity below before calling ItemHandler or changing any observable.
        // Do not remove existing vitamins, even when the personal cap is lowered.
        // Carbos must remain bounded to avoid instant-hatching eggs.
        const ceiling = vitamin === types.Carbos ? 70 : unlimited ? Number.MAX_SAFE_INTEGER : cap;
        amount = Math.min(amount, stock, Math.max(0, ceiling - used));
        if (amount === 0) return;
        if (ItemHandler.useItem(types[vitamin], amount)) {
            GameHelper.incrementObservable(this.vitaminsUsed[vitamin], amount);
        }
    }

    function refresh() {
        const enabledInput = document.getElementById('omega-protein-enabled');
        const unlimitedInput = document.getElementById('omega-protein-unlimited');
        const capInput = document.getElementById('omega-protein-cap');
        if (enabledInput) enabledInput.checked = enabled;
        if (unlimitedInput) unlimitedInput.checked = unlimited;
        if (capInput) capInput.value = cap;
    }
    const settings = window.omegaProteinSettings = {
        setEnabled(value) {
            const current = PartyPokemon.prototype.useVitamin;
            if (value === true && current !== originalUseVitamin && current !== useVitamin) {
                enabled = false;
                refresh();
                Notifier.notify({ message: 'Another script changed vitamin use. Omega Protein Gains stays OFF to preserve it.', type: NotificationConstants.NotificationOption.warning });
                return false;
            }
            enabled = value === true;
            if (enabled) {
                PartyPokemon.prototype.useVitamin = useVitamin;
            } else if (PartyPokemon.prototype.useVitamin === useVitamin) {
                PartyPokemon.prototype.useVitamin = originalUseVitamin;
            }
            refresh();
        },
        setUnlimited(value) {
            unlimited = value === true;
            refresh();
        },
        setCap(value) {
            if (!validCount(value)) return false;
            cap = value;
            localStorage.setItem('omegaProteinCap', JSON.stringify(cap));
            refresh();
            return true;
        },
    };

    let container = document.getElementById('settings-scripts-container');
    if (!container) {
        const tabs = document.querySelector('#settingsModal ul.nav-tabs');
        const content = document.querySelector('#settingsModal .tab-content');
        if (!tabs || !content) return;
        const li = document.createElement('li');
        li.className = 'nav-item';
        li.innerHTML = '<a class="nav-link" href="#settings-scripts" data-toggle="tab" role="tab">Scripts</a>';
        tabs.appendChild(li);
        const pane = document.createElement('div');
        pane.className = 'tab-pane';
        pane.id = 'settings-scripts';
        pane.setAttribute('role', 'tabpanel');
        container = document.createElement('div');
        container.id = 'settings-scripts-container';
        pane.appendChild(container);
        content.appendChild(pane);
    }
    const table = document.createElement('table');
    table.className = 'table table-striped table-hover m-0';
    table.innerHTML = `<thead><tr><th colspan="2">Omega Protein Gains</th></tr></thead>
        <tbody id="settings-scripts-omegaproteingains">
            <tr><td><label for="omega-protein-enabled">Override native vitamin limit</label></td>
                <td><input id="omega-protein-enabled" type="checkbox" aria-describedby="omega-protein-help"></td></tr>
            <tr><td><label for="omega-protein-cap">Personal ceiling per Pokémon, per vitamin (Protein / Calcium)</label></td>
                <td><input id="omega-protein-cap" type="number" min="0" max="${Number.MAX_SAFE_INTEGER}" step="1" class="form-control" aria-describedby="omega-protein-help"></td></tr>
            <tr><td><label for="omega-protein-unlimited">Unlimited Protein / Calcium (ignore personal ceiling)</label></td>
                <td><input id="omega-protein-unlimited" type="checkbox" aria-describedby="omega-protein-help"></td></tr>
            <tr><td colspan="2" id="omega-protein-help">Optional cheat for a copy of your save. Both switches start OFF on every load. The ceiling saves automatically. Existing vitamins are kept when lowering it or turning OFF. Carbos stays capped at 70 while the override is ON.</td></tr>
        </tbody>`;
    const next = Array.from(container.children).find(element => (element.querySelector('tbody')?.id ?? '') > 'settings-scripts-omegaproteingains');
    container.insertBefore(table, next || null);
    document.getElementById('omega-protein-enabled').addEventListener('change', event => settings.setEnabled(event.target.checked));
    document.getElementById('omega-protein-unlimited').addEventListener('change', event => settings.setUnlimited(event.target.checked));
    document.getElementById('omega-protein-cap').addEventListener('change', event => {
        const input = event.target;
        if (!settings.setCap(input.value === '' ? NaN : Number(input.value))) {
            refresh();
            Notifier.notify({ message: 'Enter a finite, non-negative whole number for the vitamin ceiling.', type: NotificationConstants.NotificationOption.warning });
        }
    });
    refresh();
}

function loadEpheniaScript(scriptName, initFunction, priorityFunction) {
    function reportScriptError(scriptName, error) {
        console.error(`Error while initializing '${scriptName}' userscript:\n${error}`);
        Notifier.notify({
            type: NotificationConstants.NotificationOption.warning,
            title: scriptName,
            message: `The '${scriptName}' userscript crashed while loading. Check for updates or disable the script, then restart the game.\n\nReport script issues to the script developer, not to the Pokéclicker team.`,
            timeout: GameConstants.DAY,
        });
    }
    const windowObject = !App.isUsingClient ? unsafeWindow : window;
    // Inject handlers if they don't exist yet
    if (windowObject.epheniaScriptInitializers === undefined) {
        windowObject.epheniaScriptInitializers = {};
        const oldInit = Preload.hideSplashScreen;
        var hasInitialized = false;

        // Initializes scripts once enough of the game has loaded
        Preload.hideSplashScreen = function (...args) {
            var result = oldInit.apply(this, args);
            if (App.game && !hasInitialized) {
                // Initialize all attached userscripts
                Object.entries(windowObject.epheniaScriptInitializers).forEach(([scriptName, initFunction]) => {
                    try {
                        initFunction();
                    } catch (e) {
                        reportScriptError(scriptName, e);
                    }
                });
                hasInitialized = true;
            }
            return result;
        }
    }

    // Prevent issues with duplicate script names
    if (windowObject.epheniaScriptInitializers[scriptName] !== undefined) {
        console.warn(`Duplicate '${scriptName}' userscripts found!`);
        Notifier.notify({
            type: NotificationConstants.NotificationOption.warning,
            title: scriptName,
            message: `Duplicate '${scriptName}' userscripts detected. This could cause unpredictable behavior and is not recommended.`,
            timeout: GameConstants.DAY,
        });
        let number = 2;
        while (windowObject.epheniaScriptInitializers[`${scriptName} ${number}`] !== undefined) {
            number++;
        }
        scriptName = `${scriptName} ${number}`;
    }
    // Add initializer for this particular script
    windowObject.epheniaScriptInitializers[scriptName] = initFunction;
    // Run any functions that need to execute before the game starts
    if (priorityFunction) {
        $(document).ready(() => {
            try {
                priorityFunction();
            } catch (e) {
                reportScriptError(scriptName, e);
                // Remove main initialization function  
                windowObject.epheniaScriptInitializers[scriptName] = () => null;
            }
        });
    }
}

if (!App.isUsingClient || localStorage.getItem('omegaproteingains') === 'true') {
    loadEpheniaScript('omegaproteingains', initOmegaProtein);
}
