// ==UserScript==
// @name          [Pokeclicker] Synthetic Shiny Synapse
// @namespace     Pokeclicker Scripts
// @author        Ephenia
// @description   Allows you to adjust and modify the shiny rates of everything specifically, as well as set a global shiny rate.
// @copyright     https://github.com/Ephenia
// @license       GPL-3.0 License
// @version       1.5.3

// @homepageURL   https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/
// @supportURL    https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/issues
// @downloadURL   https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/syntheticshinysynapse.user.js
// @updateURL     https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/syntheticshinysynapse.user.js

// @match         https://www.pokeclicker.com/
// @icon          https://www.google.com/s2/favicons?domain=pokeclicker.com
// @grant         unsafeWindow
// @run-at        document-idle
// ==/UserScript==

// Keep these seven categories in their legacy storage order. Several native rates
// are equal, and newer constants must not shift the saved array indices.
const shinyTypeNames = ['SHINY_CHANCE_BATTLE', 'SHINY_CHANCE_DUNGEON',
    'SHINY_CHANCE_STONE', 'SHINY_CHANCE_SAFARI', 'SHINY_CHANCE_SHOP',
    'SHINY_CHANCE_BREEDING', 'SHINY_CHANCE_FARM'];
const maxShinyRate = Number.MAX_SAFE_INTEGER;
const genDesc = ['Wild Pokémon shiny odds:',
                 'Dungeon Pokémon shiny odds:',
                 'Evolution Stone Pokémon shiny odds:',
                 'Safari Pokémon shiny odds:',
                 'Gift/Claimed Pokémon shiny odds:',
                 'Breeding/Hatchery Pokémon shiny odds:',
                 'Wandering/Farm Pokémon shiny odds:'
                ];
var shinyTypes;
var shinyRates = [];
var prefShinyRates;
var globalShinyState;
var globalShinyRate;
var karmaMode;
var karmaRates;
var shinyDOMUpdate;

function initShinySynapse() {
    if (document.getElementById('shinyModal')) return;
    loadShinySettings();
    getShinyRates();

    const profileModal = document.getElementById('profileModal');
    const profileDrop = document.getElementById('startMenu').querySelectorAll('ul li')[0];
    const shinyLi = document.createElement('li');
    const a = document.createElement('a');
    a.setAttribute('class', 'dropdown-item');
    a.setAttribute('href', '#shinyModal');
    a.setAttribute('data-toggle', 'modal');
    a.textContent = 'Shiny Modifier';
    a.addEventListener('click', () => { updateShinyModal(); });
    shinyLi.appendChild(a);
    profileDrop.before(shinyLi);
    const shinyMod = document.createElement('div');
    shinyMod.setAttribute("class", "modal noselect fade show");
    shinyMod.setAttribute("id", "shinyModal");
    shinyMod.setAttribute("tabindex", "-1");
    shinyMod.setAttribute("aria-labelledby", "shinyModal");
    shinyMod.setAttribute("aria-labelledby", "shinyModal");
    shinyMod.setAttribute("aria-modal", "true");
    shinyMod.setAttribute("role", "dialog");

    shinyMod.innerHTML = `<div class="modal-dialog modal-dialog-scrollable modal-dialog-centered modal-lg" role="document">
    <div class="modal-content">
        <div class="modal-header" style="justify-content: space-around;">
            <h5 class="modal-title">Shiny Modifier</h5>
            <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                <span aria-hidden="true">×</span>
            </button>
        </div>
        <div class="modal-body">
        </div>
    </div>`

    profileModal.before(shinyMod);

    document.getElementById('shinyModal').querySelector('.modal-header').querySelector('h5').outerHTML += `
    <button id="shiny-rate-global" class="btn btn-${globalShinyState ? 'success' : 'danger'}" style="margin-left:20px;">
    Global Override [${globalShinyState ? 'ON' : 'OFF'}]
    </button>
    <button id="shiny-karma-mode" class="btn btn-${karmaMode ? 'success' : 'danger'}" style="margin-left:20px;">
    Karma Mode [${karmaMode ? 'ON' : 'OFF'}]
    </button>
    <button id="shiny-dom-update" class="btn btn-${shinyDOMUpdate ? 'success' : 'danger'}" style="margin-left:20px;">
    DOM Updates [${shinyDOMUpdate ? 'ON' : 'OFF'}]
    </button>
    <button id="shiny-rates-reset" class="btn btn-primary" style="margin-left:20px;">
    Reset Rates
    </button>`
    document.getElementById('shiny-rate-global').addEventListener('click', event => { globalToggle(event); });
    document.getElementById('shiny-karma-mode').addEventListener('click', event => { toggleKarma(event); });
    document.getElementById('shiny-dom-update').addEventListener('click', event => { toggleDOM(event); });
    document.getElementById('shiny-rates-reset').addEventListener('click', () => { resetRates(); });

    const modalBody = document.querySelector('[id=shinyModal] div div [class=modal-body]');
    const shinyMulti = App.game.multiplier.getBonus('shiny');
    const fragment = new DocumentFragment();

    const head = document.createElement('div');
    head.setAttribute('id', 'shiny-modifier-head');
    head.innerHTML = `<div>Category</div><div>✨Odds</div><div>✨Shiny Bonus</div><div></div>`;
    fragment.appendChild(head);

    const global = document.createElement('div');
    global.setAttribute('class', 'shiny-modifier-view');
    global.innerHTML = `<div>Global shiny odds:</div>`;
    const globalInput = document.createElement('input');
    globalInput.setAttribute('id', `shiny-modifier-global`);
    globalInput.setAttribute('type', 'text');
    globalInput.setAttribute('placeholder', `${globalShinyRate.toLocaleString('en-US')}`);
    globalInput.addEventListener('input', event => { checkInput(event); });
    global.appendChild(globalInput);
    const globalCharm = document.createElement('div');
    globalCharm.setAttribute('id', 'shiny-charm-rate-global');
    globalCharm.textContent = `${globalShinyRate / shinyMulti}`
    global.appendChild(globalCharm);
    const globalBtn = document.createElement('button');
    globalBtn.textContent = 'Modify';
    globalBtn.setAttribute('class', 'btn btn-sm btn-success');
    globalBtn.addEventListener('click', event => {
        const rate = readShinyInput(document.getElementById('shiny-modifier-global'));
        if (rate === null) return;
        const shinyMulti = App.game.multiplier.getBonus('shiny');
        globalShinyRate = rate;
        document.getElementById('shiny-charm-rate-global').textContent = (globalShinyRate / shinyMulti);
        localStorage.setItem("globalShinyRate", JSON.stringify(globalShinyRate));
        syncShinyHooks();
    });
    global.appendChild(globalBtn);

    fragment.appendChild(global);

    for (let i = 0; i < shinyRates.length; i++) {
        const div = document.createElement('div');
        div.setAttribute('class', 'shiny-modifier-view');
        div.innerHTML = `<div>${genDesc[i]}</div>`;
        const input = document.createElement('input');
        input.setAttribute('id', `shiny-modifier-${i}`);
        input.setAttribute('type', 'text');
        input.setAttribute('placeholder', `${shinyRates[i].toLocaleString('en-US')}`);
        input.addEventListener('input', event => { checkInput(event); });
        div.appendChild(input);

        const charm = document.createElement('div');
        charm.setAttribute('id', `shiny-charm-rate-${i}`);
        charm.textContent = `${shinyRates[i] / shinyMulti}`
        div.appendChild(charm);

        const btn = document.createElement('button');
        btn.textContent = 'Modify';
        btn.setAttribute('class', 'btn btn-sm btn-success');
        btn.setAttribute('data-src', i);
        btn.addEventListener('click', event => {
            const index = +event.target.getAttribute('data-src');
            const rate = readShinyInput(document.getElementById(`shiny-modifier-${index}`));
            if (rate === null) return;
            const shinyMulti = App.game.multiplier.getBonus('shiny');
            shinyRates[index] = rate;
            prefShinyRates[index] = rate;
            document.getElementById(`shiny-charm-rate-${index}`).textContent = (prefShinyRates[index] / shinyMulti);
            localStorage.setItem("shinySetRates", JSON.stringify(prefShinyRates));
            syncShinyHooks();
        });
        div.appendChild(btn);

        fragment.appendChild(div);
    }
    modalBody.appendChild(fragment);

    let sourceIndex = -1;
    let hookRecords = [];
    let hooksEnabled = false;
    let hookGeneration;

    // Native calls are synchronous. Scope the context to each source and restore
    // it even on failure. SafariPokemon.random is the game's constructor entry
    // point, and Egg.hatch also covers its separate baby-Pokémon shiny roll.
    function hookSource(target, method, index) {
        if (!target || typeof target[method] !== 'function') return;
        const original = target[method];
        const ownDescriptor = Object.getOwnPropertyDescriptor(target, method);
        const generation = hookGeneration;
        const wrapper = function (...args) {
            if (!hooksEnabled || generation !== hookGeneration) return original.apply(this, args);
            const previous = sourceIndex;
            sourceIndex = index;
            try {
                return original.apply(this, args);
            } finally {
                sourceIndex = previous;
            }
        };
        target[method] = wrapper;
        hookRecords.push({ target, method, original, wrapper, ownDescriptor });
    }

    function syncShinyHooks() {
        const enabled = karmaMode || globalShinyState || prefShinyRates.some(rate => rate !== null);
        if (enabled === hooksEnabled) return;
        hooksEnabled = enabled;
        if (!enabled) {
            for (const { target, method, wrapper, ownDescriptor } of hookRecords.reverse()) {
                // Do not overwrite another script's later wrapper.
                if (target[method] !== wrapper) continue;
                if (ownDescriptor) Object.defineProperty(target, method, ownDescriptor);
                else delete target[method];
            }
            hookRecords = [];
            return;
        }
        const generation = hookGeneration = {};
        const nativeGenerateShiny = PokemonFactory.generateShiny;
        const ownDescriptor = Object.getOwnPropertyDescriptor(PokemonFactory, 'generateShiny');
        const wrapper = function (chance, skipBonus = false) {
            if (!hooksEnabled || generation !== hookGeneration) return nativeGenerateShiny.apply(this, arguments);
            let index = sourceIndex;
            if (index < 0) {
                // Only unique native signatures are safe outside an explicit
                // source. Safari, eggs, farm and rewards all use 1024 in 0.10.26.
                const matches = Object.keys(GameConstants).filter(key =>
                    key.startsWith('SHINY_CHANCE_') && GameConstants[key] === chance);
                index = matches.length === 1 ? shinyTypes.indexOf(matches[0]) : -1;
            }
            const nativeChance = Number.isFinite(chance) && chance > 0 ? Math.min(maxShinyRate, chance) : GameConstants.SHINY_CHANCE_BATTLE;
            let rate = nativeChance;
            let overridden = false;
            if (karmaMode) {
                if (index >= 0) { rate = karmaRates[index]; overridden = true; }
            } else if (globalShinyState) {
                rate = globalShinyRate;
                overridden = true;
            } else if (index >= 0 && prefShinyRates[index] !== null) {
                rate = prefShinyRates[index];
                overridden = true;
            }
            // Apply the native bonus once, then let the native generator own the
            // random draw and Shiny Charm use. Egg chances already include bonuses.
            const nativeBonus = skipBonus ? 1 : App.game.multiplier.getBonus('shiny');
            const bonus = Number.isFinite(nativeBonus) && nativeBonus > 0 ? nativeBonus : 1;
            // Egg.updateShinyChance stores a weighted history of step bonuses.
            // Replacing its base odds must retain that history, not discard it
            // or apply today's multiplier again. Baby rolls use skipBonus=false.
            const eggFactor = overridden && index === 5 && skipBonus
                ? nativeChance / GameConstants.SHINY_CHANCE_BREEDING : 1;
            const denominator = Math.max(1, Math.min(maxShinyRate, (rate / bonus) * eggFactor));
            const shiny = nativeGenerateShiny.call(this, denominator, true);
            if (karmaMode && index >= 0) {
                karmaRates[index] = shiny ? GameConstants[shinyTypes[index]] : Math.max(1, rate - 1);
                localStorage.setItem('shinyKarmaRates', JSON.stringify(karmaRates));
            }
            if (shinyDOMUpdate && $('#shinyModal').is(':visible')) updateShinyModal();
            return shiny;
        };
        PokemonFactory.generateShiny = wrapper;
        hookRecords.push({ target: PokemonFactory, method: 'generateShiny', wrapper, ownDescriptor });
        hookSource(PokemonFactory, 'generateWildPokemon', 0);
        hookSource(PokemonFactory, 'generateDungeonPokemon', 1);
        hookSource(PokemonFactory, 'generateDungeonBoss', 1);
        hookSource(PokemonFactory, 'generateDungeonTrainerPokemon', 1);
        hookSource(typeof EvolutionHandler === 'undefined' ? null : EvolutionHandler, 'evolve', 2);
        hookSource(typeof SafariPokemon === 'undefined' ? null : SafariPokemon, 'random', 3);
        hookSource(typeof Player === 'undefined' ? null : Player.prototype, 'pickStarter', 4);
        hookSource(typeof PokemonItem === 'undefined' ? null : PokemonItem.prototype, 'gain', 4);
        hookSource(typeof DiscordCode === 'undefined' ? null : DiscordCode.prototype, 'claim', 4);
        hookSource(typeof GiftNPC === 'undefined' ? null : GiftNPC.prototype, 'acceptGift', 4);
        hookSource(typeof Quest === 'undefined' ? null : Quest.prototype, 'claim', 4);
        hookSource(typeof BattleFrontierMilestone === 'undefined' ? null : BattleFrontierMilestone.prototype, 'gain', 4);
        hookSource(typeof Egg === 'undefined' ? null : Egg.prototype, 'hatch', 5);
        hookSource(PokemonFactory, 'generateWandererData', 6);
    }
    syncShinyHooks();

    addGlobalStyle('#shiny-modifier-head > div:nth-child(1) { width: 33% !important }');
    addGlobalStyle('#shiny-modifier-head * { width: 22% }');
    addGlobalStyle('#shiny-modifier-head { display: flex;flex-direction: row;margin-bottom: 14px;font-weight: bold;font-size: 1.1em; }');
    addGlobalStyle('.shiny-modifier-view { display: flex;flex-direction: row;justify-content: center;align-items: center;column-gap: 10px;margin-bottom: 2px; }');
    addGlobalStyle('.shiny-modifier-view > div:nth-child(1) { width: 33% !important }');
    addGlobalStyle('.shiny-modifier-view * { width: 22% }');

    function globalToggle(event) {
        const element = event.target;
        globalShinyState = !globalShinyState;
        element.setAttribute('class', `btn btn-${globalShinyState ? 'success' : 'danger'}`);
        element.textContent = `Global Override [${globalShinyState ? 'ON' : 'OFF'}]`;
        localStorage.setItem("globalShinyState", JSON.stringify(globalShinyState));
        syncShinyHooks();
    }

    function toggleKarma(event) {
        const element = event.target;
        karmaMode = !karmaMode;
        element.setAttribute('class', `btn btn-${karmaMode ? 'success' : 'danger'}`);
        element.textContent = `Karma Mode [${karmaMode ? 'ON' : 'OFF'}]`;
        localStorage.setItem("shinyKarmaMode", JSON.stringify(karmaMode));
        syncShinyHooks();
        updateShinyModal();
    }

    function toggleDOM(event) {
        const element = event.target;
        shinyDOMUpdate = !shinyDOMUpdate;
        element.setAttribute('class', `btn btn-${shinyDOMUpdate ? 'success' : 'danger'}`);
        element.textContent = `DOM Updates [${shinyDOMUpdate ? 'ON' : 'OFF'}]`;
        localStorage.setItem("shinyDOMUpdate", JSON.stringify(shinyDOMUpdate));
    }

    function resetRates() {
        const shinyMulti = App.game.multiplier.getBonus('shiny');

        globalShinyRate = 8192;
        localStorage.setItem("globalShinyRate", JSON.stringify(globalShinyRate));

        const shinyView = document.getElementsByClassName('shiny-modifier-view');
        for (let i = 0; i <= prefShinyRates.length; i++) {
            if (i == 8) {
                break;
            }
            if (i < 7) {
                prefShinyRates[i] = null;
            }
            if (0 == i) {
                shinyView[i].querySelector('input').value = globalShinyRate.toLocaleString('en-US');
                document.getElementById('shiny-charm-rate-global').textContent = (globalShinyRate / shinyMulti);
            } else {
                shinyRates[i - 1] = GameConstants[shinyTypes[i - 1]];
                shinyView[i].querySelector('input').value = shinyRates[i - 1].toLocaleString('en-US');
                document.getElementById(`shiny-charm-rate-${i - 1}`).textContent = (shinyRates[i - 1] / shinyMulti);
            }
        }
        localStorage.setItem("shinySetRates", JSON.stringify(prefShinyRates));
        syncShinyHooks();
    }

    function readShinyInput(input) {
        const text = input.value.replace(/,/g, '').trim();
        const rate = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN;
        return validShinyRate(rate) ? rate : null;
    }

    function checkInput(event) {
        const value = readShinyInput(event.target);
        if (value !== null) event.target.value = value.toLocaleString('en-US', { maximumFractionDigits: 20 });
    }

    function updateShinyModal() {
        const modifyBtns = document.getElementsByClassName('shiny-modifier-view');
        document.getElementById('shiny-modifier-global').disabled = karmaMode ? true : false;
        document.getElementById('shiny-rates-reset').disabled = karmaMode ? true : false;
        modifyBtns[0].querySelector('button').disabled = karmaMode ? true : false;
        for (let i = 0; i < shinyRates.length; i++) {
            document.getElementById(`shiny-modifier-${i}`).disabled = karmaMode ? true : false;
            document.getElementById(`shiny-modifier-${i}`).setAttribute('placeholder', `${karmaMode ? karmaRates[i].toLocaleString('en-US') : shinyRates[i].toLocaleString('en-US')}`);
            modifyBtns[i + 1].querySelector('button').disabled = karmaMode ? true : false;
        }
        const shinyMulti = App.game.multiplier.getBonus('shiny');
        for (let ii = 0; ii < shinyRates.length; ii++) {
            document.getElementById(`shiny-charm-rate-${ii}`).textContent = karmaMode ? (karmaRates[ii] / shinyMulti) : (shinyRates[ii] / shinyMulti);
        }
    }
}

function validShinyRate(rate) {
    return typeof rate === 'number' && Number.isFinite(rate) && rate >= 1 && rate <= maxShinyRate;
}

function getShinyRates() {
    shinyRates = shinyTypes.map((type, index) => prefShinyRates[index] ?? GameConstants[type]);
}

function loadShinySettings() {
    shinyTypes = [...shinyTypeNames];
    const read = (key, fallback) => {
        try {
            return JSON.parse(localStorage.getItem(key)) ?? fallback;
        } catch (_) {
            return fallback;
        }
    };
    globalShinyState = read('globalShinyState', false) === true;
    globalShinyRate = read('globalShinyRate', 8192);
    if (!validShinyRate(globalShinyRate)) globalShinyRate = 8192;
    karmaMode = read('shinyKarmaMode', false) === true;
    shinyDOMUpdate = read('shinyDOMUpdate', false) === true;
    const savedPreferences = read('shinySetRates', []);
    const savedKarma = read('shinyKarmaRates', []);
    prefShinyRates = shinyTypes.map((type, index) =>
        Array.isArray(savedPreferences) && validShinyRate(savedPreferences[index]) ? savedPreferences[index] : null);
    karmaRates = shinyTypes.map((type, index) => {
        const rate = Array.isArray(savedKarma) ? savedKarma[index] : null;
        return validShinyRate(rate) && rate <= GameConstants[type] ? rate : GameConstants[type];
    });
    for (const [key, value] of Object.entries({ globalShinyState, globalShinyRate,
        shinySetRates: prefShinyRates, shinyKarmaMode: karmaMode, shinyKarmaRates: karmaRates, shinyDOMUpdate })) {
        localStorage.setItem(key, JSON.stringify(value));
    }
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

if (!App.isUsingClient || localStorage.getItem('syntheticshinysynapse') === 'true') {
    loadEpheniaScript('syntheticshinysynapse', initShinySynapse);
}
