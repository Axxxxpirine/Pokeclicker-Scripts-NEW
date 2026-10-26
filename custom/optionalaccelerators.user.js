// ==UserScript==
// @name          [Pokeclicker] Optional Accelerators
// @namespace     Pokeclicker Scripts
// @author        Axxxxpirine
// @description   Optional farm speed, hatch EV bonuses and 2x route party attack cadence. Every effect starts OFF on reload. Earned progression persists in your save.
// @license       GPL-3.0 License
// @version       1.0.0
// @homepageURL   https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/
// @supportURL    https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/issues
// @downloadURL   https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/optionalaccelerators.user.js
// @updateURL     https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/optionalaccelerators.user.js
// @match         https://www.pokeclicker.com/
// @icon          https://www.google.com/s2/favicons?domain=pokeclicker.com
// @grant         unsafeWindow
// @run-at        document-idle
// ==/UserScript==

(() => {
    'use strict';
    if (typeof App === 'undefined' || (App.isUsingClient && localStorage.getItem('optionalaccelerators') !== 'true')) return;
    const root = App.isUsingClient ? window : unsafeWindow;

    function initOptionalAccelerators() {
        if (root.OptionalAccelerators) return;
        let farmSpeed = 1;
        let hatchEV = false;
        let routeAttack = false;
        let farmPhase = 0;
        let status = '';
        let farmHook;
        let hatchHook;
        let routeHook;
        const rewardedEggs = new WeakSet();

        // A later script may hold our wrapper inside its own. Leave that wrapper
        // inert on disable and refuse reinsertion until reload, rather than stack
        // wrappers or overwrite the later script's function.
        function installHook(previous, target, key, around) {
            if (previous?.blocked) throw Error('Another script changed this function. Reload before enabling this effect again.');
            if (previous?.active) {
                if (target === previous.target && target[key] === previous.wrapper) return previous;
                removeHook(previous);
                throw Error('Another script changed this function. Reload before enabling this effect again.');
            }
            if (!target || typeof target[key] !== 'function') throw Error('Required game API is unavailable. Effect remains OFF.');
            const original = target[key];
            const descriptor = Object.getOwnPropertyDescriptor(target, key);
            const hook = { target, key, original, descriptor, active: true, blocked: false };
            hook.wrapper = function (...args) {
                if (!hook.active) return original.apply(this, args);
                return around.call(this, original, args);
            };
            target[key] = hook.wrapper;
            if (target[key] !== hook.wrapper) throw Error('Game function cannot be changed. Effect remains OFF.');
            return hook;
        }

        function removeHook(hook) {
            if (!hook?.active) return;
            hook.active = false;
            if (hook.target[hook.key] !== hook.wrapper) {
                hook.blocked = true;
                return;
            }
            if (hook.descriptor) Object.defineProperty(hook.target, hook.key, hook.descriptor);
            else delete hook.target[hook.key];
        }

        function evAPIsAvailable() {
            return typeof Egg !== 'undefined' && typeof Egg.prototype.hatch === 'function'
                && typeof App.game?.party?.getPokemon === 'function'
                && typeof App.game?.party?.calculateEffortPoints === 'function'
                && typeof GameConstants !== 'undefined'
                && Number.isFinite(GameConstants.EP_EV_RATIO) && GameConstants.EP_EV_RATIO > 0
                && GameConstants.ShadowStatus?.None !== undefined;
        }

        function setFarmSpeed(value) {
            status = '';
            if (![0.5, 1, 2, 5, 10].includes(value)) {
                farmSpeed = 1;
                farmPhase = 0;
                removeHook(farmHook);
                status = 'Invalid farm speed. Farm effect is OFF.';
                render();
                return false;
            }
            if (value === 1) {
                farmSpeed = 1;
                farmPhase = 0;
                removeHook(farmHook);
                render();
                return true;
            }
            try {
                farmHook = installHook(farmHook, App.game?.farming, 'update', function (original, args) {
                    // Farming.update takes seconds for plots, but increments mutation,
                    // wandering and farmhand counters once per call. Repeat whole native
                    // ticks, never change GameConstants, Date, or offline Plot.update.
                    if (!Number.isFinite(args[0]) || args[0] <= 0) return original.apply(this, args);
                    farmPhase += farmSpeed;
                    const count = Math.min(10, Math.floor(farmPhase));
                    farmPhase -= count;
                    let result;
                    for (let i = 0; i < count; i++) {
                        result = original.apply(this, args);
                        if (!farmHook.active) break;
                    }
                    return result;
                });
                if (farmSpeed !== value) farmPhase = 0;
                farmSpeed = value;
                render();
                return true;
            } catch (error) {
                farmSpeed = 1;
                farmPhase = 0;
                removeHook(farmHook);
                status = error.message;
                render();
                return false;
            }
        }

        function setHatchEV(value) {
            status = '';
            if (value !== true) {
                hatchEV = false;
                removeHook(hatchHook);
                if (value !== false) status = 'Invalid hatch option. Hatch effect is OFF.';
                render();
                return value === false;
            }
            try {
                if (!evAPIsAvailable()) throw Error('Required hatch EV APIs are unavailable. Effect remains OFF.');
                hatchHook = installHook(hatchHook, Egg.prototype, 'hatch', function (original, args) {
                    // Manual, auto hatchery and native helpers all use Egg.hatch.
                    // Award only after native success and Pokérus status transitions.
                    const result = original.apply(this, args);
                    if (result !== true || !hatchEV || rewardedEggs.has(this)) return result;
                    try {
                        if (!evAPIsAvailable()) throw Error('Hatch EV APIs changed. Hatch effect is OFF.');
                        const pokemon = App.game.party.getPokemon(this.pokemon);
                        if (!pokemon) return result;
                        const earned = App.game.party.calculateEffortPoints(pokemon, false,
                            GameConstants.ShadowStatus.None, GameConstants.EP_EV_RATIO);
                        if (!Number.isFinite(earned) || earned < 0 || !Number.isFinite(pokemon.effortPoints)
                            || !Number.isSafeInteger(pokemon.effortPoints + earned)) {
                            throw Error('Invalid native effort point result. Hatch effect is OFF.');
                        }
                        rewardedEggs.add(this);
                        pokemon.effortPoints += earned;
                    } catch (error) {
                        // Optional bonus failure must never prevent native egg removal.
                        hatchEV = false;
                        removeHook(hatchHook);
                        status = error.message;
                        render();
                    }
                    return result;
                });
                hatchEV = true;
                render();
                return true;
            } catch (error) {
                hatchEV = false;
                removeHook(hatchHook);
                status = error.message;
                render();
                return false;
            }
        }

        function routeAPIsAvailable() {
            return typeof App.game?.gameTick === 'function'
                && typeof Battle !== 'undefined' && typeof Battle.catching === 'function'
                && typeof Battle.enemyPokemon === 'function'
                && Number.isFinite(Battle.counter) && Battle.counter >= 0
                && typeof GameConstants !== 'undefined' && GameConstants.GameState?.fighting !== undefined
                && Number.isFinite(GameConstants.TICK_TIME) && GameConstants.TICK_TIME > 0
                && Number.isFinite(GameConstants.BATTLE_TICK) && GameConstants.BATTLE_TICK >= GameConstants.TICK_TIME
                && Number.isSafeInteger(Battle.counter + GameConstants.TICK_TIME);
        }

        function setRouteAttack(value) {
            status = '';
            if (value !== true) {
                routeAttack = false;
                removeHook(routeHook);
                if (value !== false) status = 'Invalid route attack option. Route effect is OFF.';
                render();
                return value === false;
            }
            try {
                if (!routeAPIsAvailable()) throw Error('Required route attack APIs are unavailable. Effect remains OFF.');
                routeHook = installHook(routeHook, App.game, 'gameTick', function (original, args) {
                    try {
                        if (!routeAPIsAvailable()) throw Error('Route attack APIs changed. Route effect is OFF.');
                        if (this === App.game && this.gameState === GameConstants.GameState.fighting && !Battle.catching()) {
                            const enemy = Battle.enemyPokemon();
                            if (enemy && typeof enemy.isAlive !== 'function') throw Error('Invalid enemy API. Route effect is OFF.');
                            // Native gameTick adds its own TICK_TIME and runs the one
                            // native attack when due. Only this route counter advances
                            // faster. Capture timers, damage and all other game ticks
                            // remain native, including while the enemy is already dead.
                            if (enemy?.isAlive()) Battle.counter += GameConstants.TICK_TIME;
                        }
                    } catch (error) {
                        routeAttack = false;
                        removeHook(routeHook);
                        status = error.message;
                        render();
                    }
                    // Exactly one native call, with its original receiver and result.
                    // Native failures propagate, without retrying game progression.
                    return original.apply(this, args);
                });
                routeAttack = true;
                render();
                return true;
            } catch (error) {
                routeAttack = false;
                removeHook(routeHook);
                status = error.message;
                render();
                return false;
            }
        }

        function reset() {
            setFarmSpeed(1);
            setHatchEV(false);
            setRouteAttack(false);
        }

        function render() {
            const farm = document.getElementById('optional-accelerators-farm');
            const ev = document.getElementById('optional-accelerators-ev');
            const route = document.getElementById('optional-accelerators-route-attack');
            const message = document.getElementById('optional-accelerators-status');
            if (farm) farm.value = String(farmSpeed);
            if (ev) ev.checked = hatchEV;
            if (route) route.checked = routeAttack;
            if (message) message.textContent = status || `Farm: ${farmSpeed === 1 ? 'OFF' : `${farmSpeed}×`}. Hatch EV: ${hatchEV ? 'ON' : 'OFF'}. Route party attacks: ${routeAttack ? '2×' : 'OFF'}.`;
        }

        function buildSettings() {
            if (document.getElementById('optional-accelerators-panel')) return;
            let container = document.getElementById('settings-scripts-container');
            if (!container) {
                const tabs = document.querySelector('#settingsModal ul.nav-tabs');
                const content = document.querySelector('#settingsModal .tab-content');
                if (!tabs || !content) return;
                const item = document.createElement('li');
                item.className = 'nav-item';
                item.innerHTML = '<a class="nav-link" href="#settings-scripts" data-toggle="tab">Scripts</a>';
                tabs.appendChild(item);
                const pane = document.createElement('div');
                pane.id = 'settings-scripts';
                pane.className = 'tab-pane';
                container = document.createElement('div');
                container.id = 'settings-scripts-container';
                pane.appendChild(container);
                content.appendChild(pane);
            }
            // Match the repository's settings tables, including tbody id, so
            // later scripts can safely insert their alphabetically sorted tables.
            const panel = document.createElement('table');
            panel.id = 'optional-accelerators-panel';
            panel.className = 'table table-striped m-0';
            panel.innerHTML = `<thead><tr><th colspan="2">Optional accelerators — cheats</th></tr></thead>
                <tbody id="settings-scripts-optionalaccelerators">
                <tr><td colspan="2">All effects start OFF on every reload. Test on a copy of your save.
                Gained progression and resources persist in your save after disabling.
                Disabling restores native behavior, it does not undo earned progress.</td></tr>
                <tr><td><label for="optional-accelerators-farm">Farm simulation speed</label><br>
                Changes online berry growth, withering, mulch duration, mutation and wander checks, and farmhand work.
                Faster farmhands can spend berries and money faster. Other auto-farmer polling and offline berry growth stay unchanged.</td>
                <td><select id="optional-accelerators-farm" class="form-control" style="min-width:110px">
                <option value="0.5">0.5×</option><option value="1" selected>OFF (1×)</option>
                <option value="2">2×</option><option value="5">5×</option><option value="10">10×</option></select></td></tr>
                <tr><td><label for="optional-accelerators-ev">EV bonus from successful hatches</label><br>
                Adds 1 base EV per hatched Pokémon through native effort point calculation, including helpers.
                Native Pokérus eligibility, EV multipliers, held items and slow-EV challenge apply.
                No extra shiny or shadow bonus. Bonus EVs persist in the save.</td>
                <td><input type="checkbox" id="optional-accelerators-ev"></td></tr>
                <tr><td><label for="optional-accelerators-route-attack">2× party attack speed — routes only</label><br>
                Doubles online party attack cadence against living route enemies.
                Damage per attack, click attacks and capture duration stay native.
                Gyms, dungeons, temporary battles and Battle Frontier are unchanged.
                Faster defeats can spend more Pokéballs. Earned rewards persist.</td>
                <td><input type="checkbox" id="optional-accelerators-route-attack"></td></tr>
                <tr><td><span id="optional-accelerators-status" role="status"></span></td>
                <td><button id="optional-accelerators-reset" type="button" class="btn btn-secondary">Turn all OFF</button></td></tr>
                </tbody>`;
            container.appendChild(panel);
            document.getElementById('optional-accelerators-farm').addEventListener('change', event => setFarmSpeed(Number(event.target.value)));
            document.getElementById('optional-accelerators-ev').addEventListener('change', event => setHatchEV(event.target.checked));
            document.getElementById('optional-accelerators-route-attack').addEventListener('change', event => setRouteAttack(event.target.checked));
            document.getElementById('optional-accelerators-reset').addEventListener('click', reset);
            render();
        }

        root.OptionalAccelerators = Object.freeze({
            setFarmSpeed, setHatchEV, setRouteAttack, reset,
            getState: () => ({ farmSpeed, hatchEV, routeAttack, status }),
        });
        buildSettings();
    }

    // Use the shared Ephenia splash initializer contract without exporting a
    // loader that could replace another userscript's loader.
    if (root.epheniaScriptInitializers === undefined) {
        root.epheniaScriptInitializers = {};
        const oldInit = Preload.hideSplashScreen;
        let initialized = false;
        Preload.hideSplashScreen = function (...args) {
            const result = oldInit.apply(this, args);
            if (App.game && !initialized) {
                initialized = true;
                Object.entries(root.epheniaScriptInitializers).forEach(([name, init]) => {
                    try { init(); } catch (error) { console.error(`Error while initializing '${name}' userscript:`, error); }
                });
            }
            return result;
        };
    }
    if (!root.epheniaScriptInitializers.optionalaccelerators) {
        root.epheniaScriptInitializers.optionalaccelerators = initOptionalAccelerators;
    }
})();
