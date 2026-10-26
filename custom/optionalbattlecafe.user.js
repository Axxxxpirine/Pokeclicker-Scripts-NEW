// ==UserScript==
// @name          [Pokeclicker] Optional Battle Cafe
// @namespace     Pokeclicker Scripts
// @author        Axxxxpirine
// @description   Opt-in accelerated Cafe batches, reward-only time override and finite extra spins. OFF each reload. Berries are always paid and save changes persist.
// @license       GPL-3.0 License
// @version       1.0.1
// @homepageURL   https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/
// @supportURL    https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/issues
// @downloadURL   https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/optionalbattlecafe.user.js
// @updateURL     https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/optionalbattlecafe.user.js
// @match         https://www.pokeclicker.com/
// @grant         unsafeWindow
// @run-at        document-idle
// ==/UserScript==

var OptionalBattleCafe = (() => {
    const recipes = {
        vanilla: { label: 'Vanilla — day, clockwise, 1 s', clockwise: true, seconds: 1 },
        rubycream: { label: 'Ruby Cream — day, counterclockwise, 1 s', clockwise: false, seconds: 1 },
        matcha: { label: 'Matcha — night, clockwise, 1 s', clockwise: true, seconds: 1 },
        mint: { label: 'Mint — night, counterclockwise, 5 s', clockwise: false, seconds: 5 },
        lemon: { label: 'Lemon — night, clockwise, 5 s', clockwise: true, seconds: 5 },
        salted: { label: 'Salted — night, counterclockwise, 1 s', clockwise: false, seconds: 1 },
        rubyswirl: { label: 'Ruby Swirl — day, counterclockwise, 5 s', clockwise: false, seconds: 5 },
        caramel: { label: 'Caramel — day, clockwise, 5 s', clockwise: true, seconds: 5 },
        rainbow: { label: 'Rainbow — dusk, counterclockwise, 11 s', clockwise: false, seconds: 11 },
        cheese: { label: 'Cheesy Milcery — any time, 3600 s recipe', clockwise: true, seconds: 3600 },
    };
    let timer = null;
    let session = null;
    let panel = null;
    const element = id => panel?.querySelector(`#optional-cafe-${id}`);
    const bounded = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
        && Number.isInteger(+value) && +value >= 1 && +value <= 100;
    function available() {
        return typeof BattleCafeController !== 'undefined' && typeof BattleCafe !== 'undefined'
            && typeof TownList !== 'undefined' && typeof App !== 'undefined' && App.game?.farming?.berryInventory
            && typeof GameConstants !== 'undefined' && GameConstants.AlcremieSweet && GameConstants.Pokerus
            && typeof DayCycle !== 'undefined' && typeof DayCycle.currentDayCyclePart === 'function'
            && typeof DayCyclePart !== 'undefined';
    }
    function unlocked() {
        return available() && ['Motostoke', 'Hammerlocke', 'Wyndon'].some(name => {
            const town = TownList[name];
            return town?.isUnlocked?.() && town.content?.some(content => content instanceof BattleCafe && content.isUnlocked());
        });
    }
    function status(message) {
        if (element('status')) element('status').textContent = `${session ? 'ON' : 'OFF'} — ${message}`;
        if (element('start')) element('start').disabled = !!session || !available();
        if (element('stop')) element('stop').disabled = !session;
        if (element('add')) element('add').disabled = !!session || !available();
    }
    function stop(message = 'Stopped. Completed costs and rewards remain in your save.') {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        session = null;
        status(message);
    }
    function fail(message) { status(message); return false; }
    function costs(sweet) {
        const prices = BattleCafeController.getPrice(sweet);
        if (!Array.isArray(prices) || !prices.length) throw Error('Sweet cost unavailable.');
        // Aggregate repeated berry entries before checking, so no cost can be undercounted.
        const totals = new Map();
        for (const price of prices) {
            if (!Number.isFinite(price.amount) || price.amount <= 0) throw Error('Invalid sweet cost.');
            totals.set(price.berry, (totals.get(price.berry) || 0) + price.amount);
        }
        return [...totals].map(([berry, amount]) => {
            const inventory = App.game.farming.berryInventory[berry];
            if (typeof inventory !== 'function' || !Number.isFinite(inventory()) || inventory() < amount) throw Error('Not enough berries.');
            return { inventory, amount };
        });
    }
    function ready() {
        if (!unlocked()) throw Error('Unlock a Battle Cafe town and obtain Milcery first.');
        if (BattleCafeController.isSpinning()) throw Error('A native spin is already running.');
        if (!Number.isSafeInteger(BattleCafeController.spinsLeft()) || BattleCafeController.spinsLeft() < 1) throw Error('No spins available.');
    }
    function start(config = {}) {
        if (session) return fail('A batch is already running. Stop it first.');
        if (!available()) return fail('Cafe game data unavailable.');
        const { sweet, recipe, count, day = 'current' } = config;
        if (!bounded(count) || !Object.hasOwn(recipes, recipe)
            || !Object.values(GameConstants.AlcremieSweet).includes(sweet) || typeof sweet !== 'number'
            || !['current', 'Day', 'Night', 'Dawn', 'Dusk'].includes(day)
            || (day !== 'current' && DayCyclePart[day] === undefined)) return fail('Choose a valid sweet, recipe, time and batch count (1–100).');
        try { ready(); costs(sweet); } catch (error) { return fail(error.message); }
        session = { sweet, recipe: recipes[recipe], remaining: +count, completed: 0, day };
        status('Accelerated batch started.');
        timer = setTimeout(step, 100);
        return true;
    }
    function step() {
        timer = null;
        if (!session) return;
        const current = session;
        let ownsSpin = false;
        try {
            ready();
            const prices = costs(current.sweet);
            const controller = BattleCafeController;
            // The entire resolution is synchronous. Native spin cannot start while this flag is held.
            controller.isSpinning(true);
            ownsSpin = true;
            prices.forEach(({ inventory, amount }) => inventory(inventory() - amount));
            const originalDay = DayCycle.currentDayCyclePart;
            let reward;
            try {
                // No Date override and no persistent game clock change. Only the native reward call sees this value.
                if (current.day !== 'current') DayCycle.currentDayCyclePart = () => DayCyclePart[current.day];
                reward = controller.unlockAlcremie(current.recipe.clockwise, current.recipe.seconds, current.sweet);
            } catch (error) {
                // A reward may already have been partly granted. Never retry or refund an uncertain resolution.
                controller.spinsLeft(controller.spinsLeft() - 1);
                throw error;
            } finally {
                DayCycle.currentDayCyclePart = originalDay;
            }
            if (reward.getPokerusStatus() !== GameConstants.Pokerus.Resistant) controller.spinsLeft(controller.spinsLeft() - 1);
            current.completed++;
            current.remaining--;
            if (!current.remaining) stop(`Completed ${current.completed} accelerated spin(s).`);
            else status(`${current.completed} completed, ${current.remaining} remaining.`);
        } catch (error) {
            stop(error.message);
        } finally {
            if (ownsSpin) BattleCafeController.isSpinning(false);
        }
        if (session === current) timer = setTimeout(step, 100);
    }
    function addSpins(value) {
        if (session) return fail('Stop the batch before adding spins.');
        if (!bounded(value)) return fail('Extra spins must be an integer from 1 to 100.');
        if (!unlocked()) return fail('Unlock a Battle Cafe town and obtain Milcery first.');
        if (BattleCafeController.isSpinning()) return fail('Wait for the native spin to finish.');
        const total = BattleCafeController.spinsLeft() + +value;
        if (!Number.isSafeInteger(total) || total < 1) return fail('Invalid spin balance.');
        BattleCafeController.spinsLeft(total);
        status(`Added ${+value} extra spin(s). This changes your save. Berries are still required.`);
        return true;
    }
    function init() {
        window.OptionalBattleCafe = OptionalBattleCafe;
        if (document.getElementById('optional-cafe-panel')) return;
        const host = document.querySelector('#battleCafeModal .modal-body');
        if (!host) return;
        panel = document.createElement('section');
        panel.id = 'optional-cafe-panel';
        panel.className = 'border rounded p-2 mt-3';
        panel.innerHTML = `<h5>Optional Cafe cheats</h5>
            <p class="small">OFF on reload. Start runs an accelerated batch (one result every 0.1 s), including the 3600 s cheese recipe. All berry costs apply. Rewards and extra spins change your save permanently. Stop cancels only pending spins.</p>
            <label>Sweet <select id="optional-cafe-sweet" class="form-control form-control-sm"></select></label>
            <label>Recipe <select id="optional-cafe-recipe" class="form-control form-control-sm"></select></label>
            <label>Reward time <select id="optional-cafe-day" class="form-control form-control-sm"><option value="current">Current game time (no override)</option><option value="Day">Day override</option><option value="Night">Night override</option><option value="Dawn">Dawn override</option><option value="Dusk">Dusk override</option></select></label>
            <p class="small">The recipe name assumes its stated time of day. Choose the matching override to guarantee that flavor. The override applies only while resolving this reward. The cheese recipe ignores time and sweet flavor, but still costs the chosen sweet's berries.</p>
            <label>Batch size (1–100) <input id="optional-cafe-count" class="form-control form-control-sm" type="number" min="1" max="100" step="1" value="1"></label>
            <button type="button" id="optional-cafe-start" class="btn btn-warning btn-sm">Start accelerated batch</button>
            <button type="button" id="optional-cafe-stop" class="btn btn-secondary btn-sm" disabled>Stop</button>
            <hr><label>Extra spins (1–100) <input id="optional-cafe-extra-count" class="form-control form-control-sm" type="number" min="1" max="100" step="1" value="1"></label>
            <button type="button" id="optional-cafe-add" class="btn btn-outline-warning btn-sm">Add extra spins to save</button>
            <p id="optional-cafe-status" class="small mt-2" role="status" aria-live="polite"></p>`;
        panel.style.maxWidth = '100%';
        panel.querySelectorAll('label, select, input').forEach(control => {
            control.style.maxWidth = '100%';
            control.style.minWidth = '0';
        });
        panel.querySelectorAll('button').forEach(button => {
            button.style.maxWidth = '100%';
            button.style.whiteSpace = 'normal';
        });
        host.appendChild(panel);
        if (available()) Object.entries(GameConstants.AlcremieSweet).filter(([, value]) => typeof value === 'number').forEach(([name, value]) => element('sweet').add(new Option(name, value)));
        Object.entries(recipes).forEach(([key, recipe]) => element('recipe').add(new Option(recipe.label, key)));
        element('start').addEventListener('click', () => start({ sweet: +element('sweet').value, recipe: element('recipe').value, count: element('count').value, day: element('day').value }));
        element('stop').addEventListener('click', () => stop());
        element('add').addEventListener('click', () => addSpins(element('extra-count').value));
        window.addEventListener('pagehide', () => stop('Page closed.'));
        status(available() ? 'Choose options and explicitly start a batch.' : 'Cafe game data unavailable.');
    }
    return { init, start, stop, addSpins };
})();
function initOptionalBattleCafe() { OptionalBattleCafe.init(); }

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


if (typeof App !== 'undefined' && (!App.isUsingClient || (window.DesktopScriptHandler?.isEpheniaScriptEnabled('optionalbattlecafe') ?? (localStorage.getItem('optionalbattlecafe') === 'true')))) {
    loadEpheniaScript('optionalbattlecafe', initOptionalBattleCafe);
}
