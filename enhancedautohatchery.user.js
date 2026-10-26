// ==UserScript==
// @name          [Pokeclicker] Enhanced Auto Hatchery
// @namespace     Pokeclicker Scripts
// @author        Ephenia (Original/Credit: Drak + Ivan Lay, Optimatum)
// @description   Automatically hatches eggs at 100% completion. Adds On/Off controls for auto hatching and store bought eggs. Includes strict filters and fair priority IDs. Fossil incubation was removed from the game.
// @copyright     https://github.com/Ephenia
// @license       GPL-3.0 License
// @version       3.2.0

// @homepageURL   https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/
// @supportURL    https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/issues
// @downloadURL   https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/enhancedautohatchery.user.js
// @updateURL     https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/enhancedautohatchery.user.js

// @match         https://www.pokeclicker.com/
// @icon          https://www.google.com/s2/favicons?domain=pokeclicker.com
// @grant         unsafeWindow
// @run-at        document-idle
// ==/UserScript==
// Fork compatibility update, 2026-10-26: fixes for Pokéclicker 0.10.26.
// Filter Only and priority ID concepts: goldhaxx (upstream PR #430).
// Adapted here with strict filtering, validated input and fair scheduling.


var hatchState;
var eggState;
var fossilState;
var shinyFossilState;
var pkrsState;
var filterOnlyState;
var priorityIdList = [];
var priorityCursor = 0;
var priorityLastMonIds = new Map();
var priorityNeedsNormalTurn = false;
var pkrsHatcherySearchTime = 0;
var numMonsWithPkrsCached;
var autoHatcheryCachedList = [];
var hatchesSinceFilteredHatchery = 0;

function initAutoHatch() {
    const breedingDisplay = document.getElementById('breedingDisplay');
    const breedingModal = document.getElementById('breedingModal');

    breedingDisplay.querySelector('.card-header').outerHTML += `<button id= "auto-hatch-start" class="btn btn-sm btn-${hatchState ? 'success' : 'danger'}" style="position: absolute;left: 0px;top: 0px;width: 65px;height: 41px;font-size: 7pt;">
    Auto Hatch [${hatchState ? 'ON' : 'OFF'}]
    </button>`

    const autoHatchControls = document.createElement('div');
    autoHatchControls.id = 'auto-hatch-controls';
    autoHatchControls.className = 'd-flex flex-wrap p-2';
    autoHatchControls.style.gap = '8px';
    autoHatchControls.innerHTML = `<button id="pkrs-mode" class="btn btn-${pkrsState ? 'success' : 'danger'}" type="button">
    PKRS Mode [${pkrsState ? 'ON' : 'OFF'}]
    </button>
    <button id="auto-egg" class="btn btn-${eggState ? 'success' : 'danger'}" type="button">
    Auto Egg [${eggState ? 'ON' : 'OFF'}]
    </button>
    <button id="auto-fossil" class="btn btn-${fossilState ? 'success' : 'danger'}" type="button">
    Auto Fossil [${fossilState ? 'ON' : 'OFF'}]
    </button>
    <button id="shiny-fossils" class="btn btn-${shinyFossilState ? 'success' : 'danger'}" type="button">
    Shiny Fossils [${shinyFossilState ? 'ON' : 'OFF'}]
    </button>
    <button id="filter-only" type="button" class="btn btn-${filterOnlyState ? 'success' : 'danger'}"
        title="Only load Pokémon matching the current hatchery filters, including priorities and Pokérus partners. Random store eggs are paused.">
        Filter Only [${filterOnlyState ? 'ON' : 'OFF'}]
    </button>
    <div class="d-flex flex-wrap align-items-center w-100" style="gap:8px">
        <label for="priority-ids" class="mb-0">Priority IDs</label>
        <input id="priority-ids" type="text" class="form-control form-control-sm" style="width:220px;max-width:100%"
            placeholder="149, 123, 479.01" aria-describedby="priority-help priority-status">
        <button id="priority-save" type="button" class="btn btn-primary btn-sm">Save priorities</button>
    </div>
    <small id="priority-help" class="w-100">Comma or space separated. Whole IDs include forms, decimals select one form. Priorities rotate and alternate with other eligible Pokémon. PKRS Mode keeps precedence.</small>
    <small id="priority-status" class="w-100" role="status"></small>`;

    breedingModal.querySelector('.modal-header').after(autoHatchControls);
    for (const id of ['auto-fossil', 'shiny-fossils']) {
        const button = document.getElementById(id);
        button.disabled = true;
        button.textContent = id === 'auto-fossil' ? 'Fossils: use town traders' : 'Shiny Fossils: unavailable';
        button.title = 'Pokéclicker removed fossil incubation. Revive fossils at the appropriate town trader.';
    }

    document.getElementById('auto-hatch-start').addEventListener('click', event => { toggleAutoHatch(event); });
    document.getElementById('auto-egg').addEventListener('click', event => { toggleEgg(event); });
    document.getElementById('auto-fossil').addEventListener('click', event => { toggleFossil(event); });
    document.getElementById('shiny-fossils').addEventListener('click', event => { toggleShinyFossil(event); });
    document.getElementById('pkrs-mode').addEventListener('click', event => { togglePKRS(event); });

    document.getElementById('filter-only').addEventListener('click', toggleFilterOnly);
    document.getElementById('priority-save').addEventListener('click', savePriorityFromInput);
    loadPriorityIds();
    renderPriorityIds();

    addGlobalStyle('.eggSlot.disabled { pointer-events: unset !important; }');

    // Initialize list since the game won't until the hatchery menu opens
    autoHatcheryCachedList = BreedingController.hatcherySortedFilteredList();

    // Immediately refresh the cached list when the filtered list or sort settings change
    const listUpdateObservables = [BreedingController.hatcheryFilteredList, Settings.getSetting('hatcherySort').observableValue, Settings.getSetting('hatcherySortDirection').observableValue];
    listUpdateObservables.forEach(observable => observable.subscribe(() => {
        autoHatcheryCachedList = BreedingController.hatcherySortedFilteredList();
    }));

    if (hatchState) {
        autoHatcher();
    }
}

function toggleAutoHatch(event) {
    const element = event.target;
    hatchState = !hatchState;
    if (hatchState) {
        autoHatcher();
    }
    element.classList.replace(...(hatchState ? ['btn-danger', 'btn-success'] : ['btn-success', 'btn-danger']));
    element.textContent = `Auto Hatch [${hatchState ? 'ON' : 'OFF'}]`;
    localStorage.setItem('autoHatchState', hatchState);
}

function toggleEgg(event) {
    const element = event.target;
    eggState = !eggState;
    element.classList.replace(...(eggState ? ['btn-danger', 'btn-success'] : ['btn-success', 'btn-danger']));
    element.textContent = `Auto Egg [${eggState ? 'ON' : 'OFF'}]`;
    localStorage.setItem('autoEgg', eggState);
}

function toggleFossil(event) {
    const element = event.target;
    fossilState = !fossilState;
    element.classList.replace(...(fossilState ? ['btn-danger', 'btn-success'] : ['btn-success', 'btn-danger']));
    element.textContent = `Auto Fossil [${fossilState ? 'ON' : 'OFF'}]`;
    localStorage.setItem('autoFossil', fossilState);
}

function toggleShinyFossil(event) {
    const element = event.target;
    shinyFossilState = !shinyFossilState;
    element.classList.replace(...(shinyFossilState ? ['btn-danger', 'btn-success'] : ['btn-success', 'btn-danger']));
    element.textContent = `Shiny Fossils [${shinyFossilState ? 'ON' : 'OFF'}]`;
    localStorage.setItem('shinyFossil', shinyFossilState);
}

function togglePKRS(event) {
    const element = event.target;
    pkrsState = !pkrsState;
    element.classList.replace(...(pkrsState ? ['btn-danger', 'btn-success'] : ['btn-success', 'btn-danger']));
    element.textContent = `PKRS Mode [${pkrsState ? 'ON' : 'OFF'}]`;
    localStorage.setItem('pokerusModeState', pkrsState);
}

function toggleFilterOnly(event) {
    filterOnlyState = !filterOnlyState;
    const button = event.currentTarget;
    button.classList.replace(...(filterOnlyState ? ['btn-danger', 'btn-success'] : ['btn-success', 'btn-danger']));
    button.textContent = `Filter Only [${filterOnlyState ? 'ON' : 'OFF'}]`;
    localStorage.setItem('filterOnly', filterOnlyState);
    // A different eligible pool must not inherit an old failed Pokérus search.
    pkrsHatcherySearchTime = 0;
    numMonsWithPkrsCached = undefined;
}

function priorityMatches(mon, id) {
    return mon.id === id || (Number.isInteger(id) && Math.floor(mon.id) === id);
}

function parsePriorityIds(text) {
    const tokens = text.trim().split(/[,\s]+/).filter(Boolean);
    const ids = [];
    const known = tokens.length ? pokemonList : [];
    for (const token of tokens) {
        const id = Number(token);
        if (!/^\d+(?:\.\d+)?$/.test(token) || !Number.isFinite(id) || id <= 0 || !known.some(p => priorityMatches(p, id))) {
            return null;
        }
        if (!ids.includes(id)) ids.push(id);
    }
    return ids;
}

function loadPriorityIds() {
    try {
        const stored = JSON.parse(localStorage.getItem('priorityMonIds') || '[]');
        priorityIdList = Array.isArray(stored) && stored.every(id => typeof id === 'number' && Number.isFinite(id))
            ? (parsePriorityIds(stored.join(',')) || []) : [];
    } catch {
        priorityIdList = [];
    }
    localStorage.setItem('priorityMonIds', JSON.stringify(priorityIdList));
}

function renderPriorityIds() {
    document.getElementById('priority-ids').value = priorityIdList.join(', ');
    document.getElementById('priority-status').textContent = priorityIdList.length ? `Saved priorities: ${priorityIdList.join(', ')}` : 'No priorities';
}

function savePriorityFromInput() {
    const parsed = parsePriorityIds(document.getElementById('priority-ids').value);
    if (parsed === null) {
        document.getElementById('priority-status').textContent = 'Invalid or unknown Pokémon ID. Saved priorities unchanged.';
        return;
    }
    priorityIdList = parsed;
    priorityCursor = 0;
    priorityLastMonIds.clear();
    priorityNeedsNormalTurn = false;
    localStorage.setItem('priorityMonIds', JSON.stringify(priorityIdList));
    renderPriorityIds();
}

function matchesAutoHatchFilter(mon) {
    // The game's displayed sorted list is rate limited. Check the current filter too.
    return !filterOnlyState || (autoHatcheryCachedList.includes(mon) && mon.matchesHatcheryFilters());
}

function bindAutoHatcher() {
    const progressEggsOld = Breeding.prototype.progressEggs;
    Breeding.prototype.progressEggs = function progressEggs(...args) {
        const result = progressEggsOld.apply(this, args);
        if (hatchState && App.game.breeding.canAccess()) {
            autoHatcher();
        }
        return result;
    }
}

function autoHatcher() {
    if (!App.game.breeding.canAccess()) {
        return;
    }
    if (filterOnlyState) autoHatcheryCachedList = BreedingController.hatcherySortedFilteredList();
    // Attempt to hatch eggs
    for (let i = App.game.breeding.eggSlots - 1; i >= 0; i--) {
        App.game.breeding.hatchPokemonEgg(i);
    }

    if (App.game.breeding.hasFreeEggSlot()) {
        // Sort list if it's been a while
        hatchesSinceFilteredHatchery += 1;
        if (hatchesSinceFilteredHatchery > 10) {
            autoHatcheryCachedList = BreedingController.hatcherySortedFilteredList();
            hatchesSinceFilteredHatchery = 0;
        }
    }

    // Always yield to the game clock, even if an item reports success without filling a slot.
    for (let attempts = 0; attempts < App.game.breeding.eggSlots && App.game.breeding.hasFreeEggSlot(); attempts++) {
        // Attempts enabled autoHatch methods in order until one succeeds
        // (subsequent autoHatch methods aren't called due to short-circuiting)
        let success = pkrsState && autoHatchPkrs();
        success ||= !filterOnlyState && eggState && autoHatchEgg();
        success ||= fossilState && autoHatchFossil();
        success ||= autoHatchMon();
        if (!success) {
            break;
        }
    }
}

function autoHatchPkrs() {
    const delayAfterFailure = GameConstants.SECOND * 30;
    if (!App.game.keyItems.hasKeyItem(KeyItemType.Pokerus_virus)) {
        return false;
    }
    const breeding = App.game.breeding;
    const helpers = breeding.hatcheryHelpers.hired();
    const freeSlots = breeding.eggList.slice(0, breeding.eggSlots).filter((egg, index) => egg().isNone() && !helpers[index]).length;
    if (freeSlots < 2) return false;
    // Filter changes may make a previously unavailable pair eligible.
    if (!filterOnlyState && numMonsWithPkrsCached == App.game.party.caughtPokemon.length) {
        return false;
    }
    // If we couldn't find a uninfected/contagious pair, wait a while before trying again
    if (!filterOnlyState && Date.now() - pkrsHatcherySearchTime < delayAfterFailure) {
        return false;
    }
    let uninfectedMono = {};
    let uninfectedDual = {};
    let contagious = {};
    let foundPair = false;
    let infectedCount = 0;
    // Find first uninfected/contagious pair sharing a type
    // Ideally the uninfected mon is dual-type to accelerate future spreading
    for (let mon of App.game.party.caughtPokemon) {
        infectedCount += mon.pokerus > GameConstants.Pokerus.Uninfected;
        if (!mon.isHatchable() || !matchesAutoHatchFilter(mon)) {
            continue;
        }
        let checkMatch = false;
        const { type: types } = pokemonMap[mon.name];
        if (mon.pokerus == GameConstants.Pokerus.Uninfected) {
            if (types.length == 2) {
                uninfectedDual[types[0]] ??= mon;
                uninfectedDual[types[1]] ??= mon;
                checkMatch = true;
            } else {
                uninfectedMono[types[0]] ??= mon;
            }
        } else if (mon.pokerus >= GameConstants.Pokerus.Contagious) {
            for (let type of types) {
                contagious[type] ??= mon;
                checkMatch = true;
            }
        }
        // Stop searching upon finding a infectable dual-type
        if (checkMatch) {
            for (let type of types) {
                if (type in uninfectedDual && type in contagious) {
                    foundPair = {'uninfected': uninfectedDual[type], 'contagious': contagious[type]};
                }
            }
            if (foundPair) {
                break;
            }
        }
    }
    if (!foundPair) {
        numMonsWithPkrsCached = infectedCount;
        // No infectable dual-type pokemon found, try a monotype
        for (let type of GameHelper.enumNumbers(PokemonType)) {
            if (type in uninfectedMono && type in contagious) {
                foundPair = {'uninfected': uninfectedMono[type], 'contagious': contagious[type]};
                break;
            }
        }
    }
    if (foundPair) {
        let success = App.game.breeding.addPokemonToHatchery(foundPair.uninfected) && App.game.breeding.addPokemonToHatchery(foundPair.contagious);
        numMonsWithPkrsCached += success;
        return success;
    } else {
        pkrsHatcherySearchTime = Date.now();
        return false;
    }
}

function autoHatchEgg() {
    let eggList = GameHelper.enumStrings(GameConstants.EggItemType).filter(e => ItemHandler.hasItem(e));
    if (eggList.length == 0) {
        return false;
    }
    let eggToUse = eggList[Math.floor(Math.random() * eggList.length)];
    return ItemList[eggToUse].use();
}

function autoHatchFossil() {
    // Fossil eggs and FossilToPokemon were removed in the current game.
    // Keep saved preferences intact, but never call the obsolete sale/incubation path.
    return false;
}

function autoHatchMon() {
    const filtered = autoHatcheryCachedList.filter(p => p.isHatchable() && matchesAutoHatchFilter(p));
    const party = App.game.party.caughtPokemon.filter(p => p.isHatchable() && matchesAutoHatchFilter(p));
    const isPriority = p => priorityIdList.some(id => priorityMatches(p, id));
    const normal = filtered.find(p => !isPriority(p)) || (!filterOnlyState && party.find(p => !isPriority(p)));
    // Give other eligible Pokémon a turn between priorities, even across game ticks.
    if (priorityNeedsNormalTurn && normal && App.game.breeding.addPokemonToHatchery(normal)) {
        priorityNeedsNormalTurn = false;
        return true;
    }
    for (let offset = 0; offset < priorityIdList.length; offset++) {
        const index = (priorityCursor + offset) % priorityIdList.length;
        const id = priorityIdList[index];
        const family = party.filter(p => priorityMatches(p, id));
        const lastIndex = family.findIndex(p => p.id === priorityLastMonIds.get(id));
        const mon = family[(lastIndex + 1) % family.length];
        if (mon && App.game.breeding.addPokemonToHatchery(mon)) {
            priorityLastMonIds.set(id, mon.id);
            priorityCursor = (index + 1) % priorityIdList.length;
            priorityNeedsNormalTurn = true;
            return true;
        }
    }
    const toHatch = filtered[0] || (!filterOnlyState && party[0]);
    if (!toHatch) return false;
    const success = App.game.breeding.addPokemonToHatchery(toHatch);
    if (success) priorityNeedsNormalTurn = false;
    return success;
}

hatchState = loadSetting('autoHatchState', false);
eggState = loadSetting('autoEgg', false);
fossilState = loadSetting('autoFossil', false);
shinyFossilState = loadSetting('shinyFossil', false);
pkrsState = loadSetting('pokerusModeState', false);
filterOnlyState = loadSetting('filterOnly', false);

function loadSetting(key, defaultVal) {
    var val;
    try {
        val = JSON.parse(localStorage.getItem(key));
        if (val == null || typeof val !== typeof defaultVal) {
            throw new Error;
        }
    } catch {
        val = defaultVal;
        localStorage.setItem(key, defaultVal);
    }
    return val;
}

function addGlobalStyle(css) {
    var head, style;
    head = document.getElementsByTagName('head')[0];
    if (!head) { return; }
    style = document.createElement('style');
    style.type = 'text/css';
    style.innerHTML = css;
    head.appendChild(style);
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

if (!App.isUsingClient || localStorage.getItem('enhancedautohatchery') === 'true') {
    loadEpheniaScript('enhancedautohatchery', initAutoHatch, bindAutoHatcher);
}