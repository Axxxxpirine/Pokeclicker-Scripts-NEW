// ==UserScript==
// @name          [Pokeclicker] Enhanced Auto Hatchery
// @namespace     Pokeclicker Scripts
// @author        Ephenia (Original/Credit: Drak + Ivan Lay, Optimatum)
// @description   Automatically hatches eggs at 100% completion. Adds On/Off controls for auto hatching and store bought eggs. Includes strict filters and fair priority IDs. Fossil incubation was removed from the game.
// @copyright     https://github.com/Ephenia
// @license       GPL-3.0 License
// @version       3.3.4

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
var autoQueueState;
var autoQueueLimit;
var typeEfficiencyState;
var hatcheryTargetType1;
var hatcheryTargetType2;
var priorityIdList = [];
var priorityCursor = 0;
var priorityLastMonIds = new Map();
var priorityNeedsNormalTurn = false;
var pkrsHatcherySearchTime = 0;
var numMonsWithPkrsCached;
var autoHatcheryCachedList = [];
var hatchesSinceFilteredHatchery = 0;

// Ephemeral breeding intent never changes filters, priorities or item settings.
var questHatchOwner = null, questHatchObjective = null, questHatchPrevious, questHatchApplied=false;
var questHatchStatus = {status:'ready',progress:0,nextWake:0};
function registerQuestHatcheryAdapter() {
    const w=!App.isUsingClient ? unsafeWindow : window;
    const registry=w.PokeAutomationAdapters ||= {version:1,adapters:Object.create(null),movementOwner:null};
    registry.adapters.hatchery={
        inspect:()=>({...questHatchStatus,activities:[{id:'hatchery',target:{kind:'hatchery'},status:'ready',unlocked:App.game.breeding.canAccess(),
            capabilities:['hatch','capture','shiny'],rates:{}} , ...[...new Set(App.game.party.caughtPokemon.flatMap(p=>{
                const data=typeof PokemonHelper === 'undefined' ? null : PokemonHelper.getPokemonById(p.id);
                return data ? [data.type1,data.type2].filter(t=>t>=0):[];
            }))].map(type=>({id:`hatchery:${type}`,target:{kind:'hatchery'},types:[type],type,
                status:'ready',unlocked:App.game.breeding.canAccess(),capabilities:['captureType'],rates:{}}))]}),
        acquire(owner) {if (questHatchOwner && questHatchOwner !== owner) return false;
            questHatchOwner=owner;questHatchPrevious=hatchState;questHatchApplied=false;return true;},
        apply(owner,objective) {if (owner !== questHatchOwner || !owner?.active || !owner.isCurrent()) return false;
            if (questHatchApplied && hatchState !== true) {owner.onManual('Manual hatchery state');return false;}
            questHatchObjective=objective;hatchState=true;questHatchApplied=true;questHatchTick();return true;},
        release(owner) {if (owner !== questHatchOwner) return;
            if (questHatchApplied && hatchState === true) hatchState=questHatchPrevious;
            questHatchOwner=null;questHatchObjective=null;questHatchStatus={status:'ready',progress:0,nextWake:0};}
    };
}
function questHatchTick() {
    const breeding=App.game.breeding;
    if (!breeding.canAccess()) {questHatchStatus={status:'blocked',reason:'Hatchery locked',nextWake:Date.now()+1000};return;}
    for (let i=0;i<breeding.eggSlots;i++) {
        const egg=breeding.eggList[i]?.();
        if (egg && !egg.isNone() && egg.canHatch()) breeding.hatchPokemonEgg(i);
    }
    // Native queues own the free slots. Avoid scanning a large party when nothing can be added.
    if (breeding.queueList?.().length || !breeding.hasFreeEggSlot()) {
        questHatchStatus={status:'waiting',reason:breeding.queueList?.().length ? 'Waiting for native hatchery queue':'Waiting for battle egg steps',
            progress:0,nextWake:Date.now()+1000};
        return;
    }
    const party=App.game.party;
    const combatants=party.partyPokemonActiveInSubRegion?.(typeof player === 'undefined' ? undefined : player.region,typeof player === 'undefined' ? undefined : player.subregion) ?? party.caughtPokemon;
    const combatSet=new Set(combatants);
    // Only native subregion combatants can satisfy the reserve (not other species in Magikarp Jump).
    const reserve=Math.max(1,Math.ceil(combatants.length/2));
    const ignoreRegion=typeof GameConstants !== 'undefined' && typeof player !== 'undefined'
        && player.region === GameConstants.Region?.alola && player.subregion === GameConstants.AlolaSubRegions?.MagikarpJump;
    const attacks=new Map(combatants.map(p=>[p,Math.max(0,Number(party.calculateOnePokemonAttack?.(p,undefined,undefined,undefined,ignoreRegion,true) ?? p.attack ?? 1) || 0)]));
    const attack=p=>attacks.get(p) ?? 0;
    const totalAttack=combatants.reduce((sum,p)=>sum+attack(p),0);
    let fighting=combatants.filter(p=>!p.breeding).length;
    let removedAttack=combatants.filter(p=>p.breeding).reduce((sum,p)=>sum+attack(p),0), added=0;
    for (const p of party.caughtPokemon.filter(p=>!p.breeding).sort((a,b)=>attack(a)-attack(b))) {
        if (!breeding.hasFreeEggSlot()) break;
        if (p.level < 100 || p.breeding || (p.isHatchable && !p.isHatchable())) continue;
        if (questHatchObjective?.type != null) {
            const data=PokemonHelper.getPokemonById(p.id);
            if (![data?.type1,data?.type2].includes(questHatchObjective.type)) continue;
        }
        if (combatSet.has(p) && (fighting <= reserve || removedAttack+attack(p) > totalAttack/2)) continue;
        if (breeding.addPokemonToHatchery(p)) {
            added++;
            if (combatSet.has(p)) {fighting--;removedAttack+=attack(p);}
        }
    }
    questHatchStatus={status:'waiting',reason:breeding.queueList?.().length ? 'Waiting for native hatchery queue':'Waiting for battle egg steps or eligible level 100 breeders',
        progress:added,nextWake:Date.now()+1000};
}

function initAutoHatch() {
    registerQuestHatcheryAdapter();
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
    initHatcheryQueueOptions(autoHatchControls);
    for (const element of autoHatchControls.querySelectorAll('button,input,select')) {
        for (const event of ['click','change']) element.addEventListener(event,()=>questHatchOwner?.onManual('Manual hatchery settings'),true);
    }

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
    const requested = !hatchState;
    questHatchOwner?.onManual('Manual hatchery control');
    hatchState = requested;
    if (hatchState) {
        autoHatcher();
    }
    element.classList.replace(...(hatchState ? ['btn-danger', 'btn-success'] : ['btn-success', 'btn-danger']));
    element.textContent = `Auto Hatch [${hatchState ? 'ON' : 'OFF'}]`;
    localStorage.setItem('autoHatchState', hatchState);
}

function toggleEgg(event) {
    questHatchOwner?.onManual('Manual hatchery settings');
    const element = event.target;
    eggState = !eggState;
    element.classList.replace(...(eggState ? ['btn-danger', 'btn-success'] : ['btn-success', 'btn-danger']));
    element.textContent = `Auto Egg [${eggState ? 'ON' : 'OFF'}]`;
    localStorage.setItem('autoEgg', eggState);
}

function toggleFossil(event) {
    questHatchOwner?.onManual('Manual hatchery settings');
    const element = event.target;
    fossilState = !fossilState;
    element.classList.replace(...(fossilState ? ['btn-danger', 'btn-success'] : ['btn-success', 'btn-danger']));
    element.textContent = `Auto Fossil [${fossilState ? 'ON' : 'OFF'}]`;
    localStorage.setItem('autoFossil', fossilState);
}

function toggleShinyFossil(event) {
    questHatchOwner?.onManual('Manual hatchery settings');
    const element = event.target;
    shinyFossilState = !shinyFossilState;
    element.classList.replace(...(shinyFossilState ? ['btn-danger', 'btn-success'] : ['btn-success', 'btn-danger']));
    element.textContent = `Shiny Fossils [${shinyFossilState ? 'ON' : 'OFF'}]`;
    localStorage.setItem('shinyFossil', shinyFossilState);
}

function togglePKRS(event) {
    questHatchOwner?.onManual('Manual hatchery settings');
    const element = event.target;
    pkrsState = !pkrsState;
    element.classList.replace(...(pkrsState ? ['btn-danger', 'btn-success'] : ['btn-success', 'btn-danger']));
    element.textContent = `PKRS Mode [${pkrsState ? 'ON' : 'OFF'}]`;
    localStorage.setItem('pokerusModeState', pkrsState);
}

function toggleFilterOnly(event) {
    questHatchOwner?.onManual('Manual hatchery settings');
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
    if (questHatchOwner) {
        if (questHatchOwner.active && questHatchOwner.isCurrent()) questHatchTick();
        return;
    }
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

    // Native progress processes the existing queue first. Do not jump ahead of a
    // manually queued entry when Auto Hatch is toggled between progress ticks.
    if (typeof App.game.breeding.queueList === 'function' && App.game.breeding.queueList().length && App.game.breeding.hasFreeEggSlot()) return;

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
    fillAutoHatchQueue();
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

function autoHatchOccupiedIds() {
    const breeding = App.game.breeding;
    const ids = new Set();
    if (typeof breeding.queueList === 'function' && typeof EggType !== 'undefined') {
        breeding.queueList().forEach(entry => { if (entry[0] === EggType.Pokemon) ids.add(entry[1]); });
    }
    (breeding.eggList || []).forEach(slot => {
        const egg = slot();
        if (egg && !egg.isNone() && Number.isFinite(egg.pokemon)) ids.add(egg.pokemon);
    });
    return ids;
}

function fillAutoHatchQueue() {
    // Queue entries may start before the next script tick. Only enqueue ordinary
    // breeding while modes that need immediate paired/random decisions are off.
    if (!hatchState || !autoQueueState || pkrsState || eggState) return;
    const breeding = App.game.breeding;
    if (typeof breeding.queueList !== 'function' || typeof breeding.usableQueueSlots !== 'function' || typeof breeding.addPokemonToQueue !== 'function' || typeof EggType === 'undefined') return;
    const capacity = breeding.usableQueueSlots();
    if (!Number.isSafeInteger(capacity) || capacity <= 0) return;
    const target = Math.min(capacity, autoQueueLimit);
    // Never remove or reorder existing entries, including after lowering a limit.
    for (let attempt = 0; attempt < target && breeding.queueList().length < target; attempt++) {
        const previousLength = breeding.queueList().length;
        if (!autoHatchMon(true) || breeding.queueList().length <= previousLength) break;
    }
}

function sortAutoHatchEfficiency(list) {
    if (!typeEfficiencyState || typeof TypeHelper === 'undefined' || typeof TypeHelper.getAttackModifier !== 'function' || typeof BreedingController.calculateRegionalMultiplier !== 'function' || typeof PokemonHelper === 'undefined' || typeof PokemonHelper.getPokemonById !== 'function') return list;
    const scores = new Map();
    for (const pokemon of list) {
        const data = PokemonHelper.getPokemonById(pokemon.id);
        if (!data || !Number.isInteger(data.type1) || !Number.isInteger(data.type2) || typeof pokemon.breedingEfficiency !== 'function') return list;
        const score = pokemon.breedingEfficiency() * BreedingController.calculateRegionalMultiplier(pokemon)
            * TypeHelper.getAttackModifier(data.type1, data.type2, hatcheryTargetType1, hatcheryTargetType2);
        if (!Number.isFinite(score) || score < 0) return list;
        scores.set(pokemon, score);
    }
    // Stable sort keeps the game's ordering for ties. Priority rotation still
    // chooses the next family before considering ordinary candidates.
    return [...list].sort((a, b) => scores.get(b) - scores.get(a));
}

function initHatcheryQueueOptions(container) {
    const options = document.createElement('div');
    options.className = 'd-flex flex-wrap align-items-center w-100';
    options.style.gap = '8px';
    options.innerHTML = `<button id="auto-queue" type="button" class="btn"></button>
        <label for="auto-queue-limit" class="mb-0">Queue target (1–100)</label>
        <input id="auto-queue-limit" type="number" class="form-control form-control-sm" style="width:90px" min="1" max="100" step="1">
        <small class="w-100">Requires Auto Hatch. Appends eligible Pokémon up to this total or the native capacity. Existing entries remain in order. Paused while PKRS Mode or Auto Egg is ON. Turning OFF or changing filters leaves previously queued entries intact.</small>
        <button id="hatchery-type-sort" type="button" class="btn"></button>
        <label for="hatchery-target-type1" class="mb-0">Target type</label><select id="hatchery-target-type1" class="custom-select custom-select-sm" style="width:110px"></select>
        <label for="hatchery-target-type2" class="mb-0">Second type</label><select id="hatchery-target-type2" class="custom-select custom-select-sm" style="width:110px"></select>
        <small class="w-100">Type efficiency = native breeding efficiency × hatchery regional multiplier × native attack modifier against the selected target types (including gems). Native efficiency = attack gained ÷ egg steps × egg-cycle multiplier, using the game's modifier setting. Weather and temporary attack boosts are excluded. Higher scores go first within eligible candidates. PKRS and priority rotation still take precedence.</small>
        <small id="hatchery-queue-status" class="w-100" role="status"></small>`;
    container.append(options);
    const render = () => {
        for (const [id, label, enabled] of [['auto-queue', 'Auto Queue', autoQueueState], ['hatchery-type-sort', 'Type Efficiency', typeEfficiencyState]]) {
            const button = document.getElementById(id);
            button.className = `btn btn-${enabled ? 'success' : 'danger'}`;
            button.textContent = `${label} [${enabled ? 'ON' : 'OFF'}]`;
            button.setAttribute('aria-pressed', String(enabled));
        }
    };
    document.getElementById('auto-queue').addEventListener('click', () => { autoQueueState = !autoQueueState; localStorage.setItem('autoHatchQueue', autoQueueState); render(); });
    document.getElementById('hatchery-type-sort').addEventListener('click', () => { typeEfficiencyState = !typeEfficiencyState; localStorage.setItem('autoHatchTypeSort', typeEfficiencyState); render(); });
    const limit = document.getElementById('auto-queue-limit');
    limit.value = autoQueueLimit;
    limit.addEventListener('change', () => {
        const next = Number(limit.value);
        const status = document.getElementById('hatchery-queue-status');
        if (!Number.isInteger(next) || next < 1 || next > 100) {
            limit.value = autoQueueLimit;
            status.textContent = 'Enter a whole queue target from 1 to 100. Previous target retained.';
            return;
        }
        autoQueueLimit = next;
        localStorage.setItem('autoHatchQueueLimit', next);
        status.textContent = 'Queue target saved. Existing entries are preserved.';
    });
    const types = typeof PokemonType === 'undefined' ? [] : Object.entries(PokemonType).filter(([name, id]) => typeof id === 'number' && id >= 0);
    if (!types.some(([, id]) => id === hatcheryTargetType1)) hatcheryTargetType1 = types[0]?.[1] ?? 0;
    if (!types.some(([, id]) => id === hatcheryTargetType2)) hatcheryTargetType2 = -1;
    for (const secondary of [false, true]) {
        const select = document.getElementById(secondary ? 'hatchery-target-type2' : 'hatchery-target-type1');
        for (const [name, id] of secondary ? [['None', -1], ...types] : types) {
            const option = document.createElement('option'); option.value = id; option.textContent = name; select.append(option);
        }
        select.value = secondary ? hatcheryTargetType2 : hatcheryTargetType1;
        select.addEventListener('change', () => {
            const value = Number(select.value);
            if (secondary) hatcheryTargetType2 = value; else hatcheryTargetType1 = value;
            localStorage.setItem(secondary ? 'autoHatchTargetType2' : 'autoHatchTargetType1', value);
        });
    }
    render();
}

function autoHatchMon(enqueue = false) {
    const occupied = autoHatchOccupiedIds();
    const eligible = p => p.isHatchable() && !occupied.has(p.id) && matchesAutoHatchFilter(p);
    const filtered = sortAutoHatchEfficiency(autoHatcheryCachedList.filter(eligible));
    const party = sortAutoHatchEfficiency(App.game.party.caughtPokemon.filter(eligible));
    const submit = pokemon => enqueue ? App.game.breeding.addPokemonToQueue(pokemon) : App.game.breeding.addPokemonToHatchery(pokemon);
    const isPriority = p => priorityIdList.some(id => priorityMatches(p, id));
    const normal = filtered.find(p => !isPriority(p)) || (!filterOnlyState && party.find(p => !isPriority(p)));
    // Give other eligible Pokémon a turn between priorities, even across game ticks.
    if (priorityNeedsNormalTurn && normal && submit(normal)) {
        priorityNeedsNormalTurn = false;
        return true;
    }
    for (let offset = 0; offset < priorityIdList.length; offset++) {
        const index = (priorityCursor + offset) % priorityIdList.length;
        const id = priorityIdList[index];
        const family = party.filter(p => priorityMatches(p, id));
        const lastIndex = family.findIndex(p => p.id === priorityLastMonIds.get(id));
        const mon = family[(lastIndex + 1) % family.length];
        if (mon && submit(mon)) {
            priorityLastMonIds.set(id, mon.id);
            priorityCursor = (index + 1) % priorityIdList.length;
            priorityNeedsNormalTurn = true;
            return true;
        }
    }
    const toHatch = filtered[0] || (!filterOnlyState && party[0]);
    if (!toHatch) return false;
    const success = submit(toHatch);
    if (success) priorityNeedsNormalTurn = false;
    return success;
}

hatchState = loadSetting('autoHatchState', false);
eggState = loadSetting('autoEgg', false);
fossilState = loadSetting('autoFossil', false);
shinyFossilState = loadSetting('shinyFossil', false);
pkrsState = loadSetting('pokerusModeState', false);
filterOnlyState = loadSetting('filterOnly', false);
autoQueueState = loadSetting('autoHatchQueue', false);
autoQueueLimit = loadSetting('autoHatchQueueLimit', 10);
if (!Number.isInteger(autoQueueLimit) || autoQueueLimit < 1 || autoQueueLimit > 100) autoQueueLimit = 10;
typeEfficiencyState = loadSetting('autoHatchTypeSort', false);
hatcheryTargetType1 = loadSetting('autoHatchTargetType1', 0);
hatcheryTargetType2 = loadSetting('autoHatchTargetType2', -1);

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

if (!App.isUsingClient || (window.DesktopScriptHandler?.isEpheniaScriptEnabled('enhancedautohatchery') ?? (localStorage.getItem('enhancedautohatchery') === 'true'))) {
    loadEpheniaScript('enhancedautohatchery', initAutoHatch, bindAutoHatcher);
}