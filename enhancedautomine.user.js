// ==UserScript==
// @name          [Pokeclicker] Enhanced Auto Mine
// @namespace     Pokeclicker Scripts
// @author        Ephenia (Credit: falcon71, KarmaAlex, umbralOptimatum, Pastaficionado)
// @description   Adaptive mining with smart tool targeting, full Cell Battery discharge, sale reserves and session rates. Compatible with Pokéclicker 0.10.26.
// @copyright     https://github.com/Ephenia
// @license       GPL-3.0 License
// @version       3.2.2

// @homepageURL   https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/
// @supportURL    https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/issues
// @downloadURL   https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/enhancedautomine.user.js
// @updateURL     https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/enhancedautomine.user.js

// @match         https://www.pokeclicker.com/
// @icon          https://www.google.com/s2/favicons?domain=pokeclicker.com
// @grant         unsafeWindow
// @run-at        document-idle
// ==/UserScript==

// Fork compatibility update, 2026-10-26: Pokéclicker 0.10.26 underground.
// The old energy, restores, survey-count and skip APIs no longer exist.
var mineState = loadMineSetting('autoMineState', false);
var autoMineBatteryState = loadMineSetting('autoMineBattery', true);
var sellTreasureState = loadMineSetting('autoSellTreasure', false);
var autoMineTimer;
var layersMined;
var autoMineReservesValid = true;
var autoMineReserveInputsValid = true;
var autoMineSellReserves = loadAutoMineReserves();
var autoMineSession;
var autoMineLastRateUpdate = -Infinity;

var questMineOwner=null, questMinePrevious, questMineApplied=false, questMineStatus={status:'ready',progress:0,nextWake:0};
function registerQuestMineAdapter() {
    const w=!App.isUsingClient ? unsafeWindow : window;
    const registry=w.PokeAutomationAdapters ||= {version:1,adapters:Object.create(null),movementOwner:null};
    registry.adapters.mine={
        inspect:()=>({...questMineStatus,activities:[{id:'mine',target:{kind:'mine'},unlocked:App.game.underground.canAccess(),
            status:typeof App.game.underground.generateMine === 'function' ? 'ready':'blocked',reason:'Native mine search unavailable',
            capabilities:['layers','items'],rates:{}}]}),
        acquire(owner) {if (questMineOwner && questMineOwner !== owner) return false;
            questMineOwner=owner;questMinePrevious=mineState;questMineApplied=false;clearTimeout(autoMineTimer);autoMineTimer=undefined;return true;},
        apply(owner) {
            if (owner !== questMineOwner || !owner?.active || !owner.isCurrent()) return false;
            if (questMineApplied && mineState !== true) {owner.onManual('Manual mining state');return false;}
            mineState=true;questMineApplied=true;
            const underground=App.game.underground;
            if (!underground.canAccess()) {questMineStatus={status:'blocked',reason:'Underground locked',nextWake:Date.now()+1000};return true;}
            // Native generateMine initializes its own discovery timer and rewards.
            // Never replace an unfinished or currently searching mine.
            if (!underground.mine || underground.mine.completed || underground.mine.itemsFound >= underground.mine.itemsBuried) {
                if (underground.battery?.toJSON?.()?.activeDischargeID != null) {autoMineWait('Battery discharging — waiting for animation',100);return true;}
                if (typeof underground.generateMine !== 'function') {questMineStatus={status:'blocked',reason:'Native mine search unavailable'};return true;}
                underground.generateMine(underground.autoSearchMineType);
            }
            doAutoMine();return true;
        },
        release(owner,reason='') {if (owner !== questMineOwner) return;
            if (questMineApplied && mineState === true) mineState=questMinePrevious;
            questMineOwner=null;questMineStatus={status:'ready',progress:0,nextWake:0};
            if (!/manual/i.test(reason)) updateAutoMineTimer();}
    };
}

function initAutoMine() {
    registerQuestMineAdapter();
    if (document.getElementById('auto-mine-start')) {
        return;
    }
    const controls = document.createElement('div');
    controls.className = 'mb-2';
    controls.innerHTML = `<div class="d-flex flex-wrap">
        <button id="auto-mine-start" class="btn btn-${mineState ? 'success' : 'danger'}">Auto Mine [${mineState ? 'ON' : 'OFF'}]</button>
        <button id="auto-mine-battery" class="btn btn-${autoMineBatteryState ? 'success' : 'danger'}" aria-pressed="${autoMineBatteryState}">Auto Battery [${autoMineBatteryState ? 'ON' : 'OFF'}]</button>
        <button id="auto-sell-treasure" class="btn btn-${sellTreasureState ? 'success' : 'danger'}">Auto Sell Treasure [${sellTreasureState ? 'ON' : 'OFF'}]</button>
        </div>
        <div id="auto-mine-status" role="status">Stopped</div>
        <div id="auto-mine-warning" class="text-warning"></div>
        <div id="auto-mine-rates" class="small"></div>
        <small>Session totals include manual mining and helpers, using the game's treasure-found counter. Adaptive speed: up to 20 tool actions/s. Bombs are never used. Auto Battery needs Auto Mine ON.</small>
        <details class="mt-2"><summary>Sale reserves</summary>
            <div class="d-flex flex-wrap align-items-center" style="gap: .5rem">
                <label>Default reserve <input id="auto-mine-reserve-default" type="number" min="0" max="1000000000" step="1" required style="width: 7rem"></label>
                <label>Item <select id="auto-mine-reserve-select"></select></label>
                <label>Item reserve <input id="auto-mine-reserve-item" type="number" min="0" max="1000000000" step="1" placeholder="Default" style="width: 7rem"></label>
            </div>
            <small>Leave the item reserve blank to use the default. Only surplus is sold after a completed layer. Locked items are always kept.</small>
            <div id="auto-mine-reserve-message" class="text-warning" role="status"></div>
        </details>`;
    document.querySelector('#mineModal .modal-body').prepend(controls);
    document.getElementById('auto-mine-start').addEventListener('click', startAutoMine);
    document.getElementById('auto-mine-battery').addEventListener('click', toggleAutoMineBattery);
    document.getElementById('auto-sell-treasure').addEventListener('click', autoSellTreasure);
    initAutoMineReserveControls();
    for (const element of controls.querySelectorAll('button,input,select')) {
        if (element.id === 'auto-mine-start') continue;
        for (const event of ['click','change']) element.addEventListener(event,()=>questMineOwner?.onManual('Manual mining settings'),true);
    }
    layersMined = App.game.statistics.undergroundLayersMined();
    if (mineState) startAutoMineSession();
    updateAutoMineDisplay(mineState ? 'Ready' : 'Stopped', true);
    updateAutoMineTimer();
}

function updateAutoMineTimer() {
    clearTimeout(autoMineTimer);
    autoMineTimer = undefined;
    if (mineState) {
        autoMineTimer = setTimeout(runAutoMine, 50);
    }
}

function runAutoMine() {
    autoMineTimer = undefined;
    if (!mineState || questMineOwner) return;
    try {
        const delay = doAutoMine();
        // One action per callback, no catch-up bursts after a suspended tab.
        if (mineState) autoMineTimer = setTimeout(runAutoMine, Math.max(50, Math.min(1000, delay)));
    } catch (error) {
        console.error('Auto Mine stopped:', error);
        setAutoMineState(false);
        updateAutoMineDisplay('Stopped after an error. Restart Auto Mine or reload the game.', true);
    }
}

function startAutoMine() {
    const requested=!mineState;
    questMineOwner?.onManual('Manual mining control');
    setAutoMineState(requested);
}

function setAutoMineState(enabled) {
    if (enabled) {
        startAutoMineSession();
        // Layers completed while OFF must not trigger a delayed inventory sale.
        layersMined = App.game.statistics.undergroundLayersMined();
    } else if (autoMineSession) {
        autoMineSession.end = performance.now();
        autoMineSession.finalItems = App.game.statistics.undergroundItemsFound?.() ?? 0;
        autoMineSession.finalLayers = App.game.statistics.undergroundLayersMined();
    }
    mineState = enabled;
    const button = document.getElementById('auto-mine-start');
    button.classList.toggle('btn-success', enabled);
    button.classList.toggle('btn-danger', !enabled);
    button.textContent = `Auto Mine [${enabled ? 'ON' : 'OFF'}]`;
    button.setAttribute('aria-pressed', String(enabled));
    localStorage.setItem('autoMineState', mineState);
    updateAutoMineDisplay(enabled ? 'Ready' : 'Stopped', true);
    updateAutoMineTimer();
}

function doAutoMine() {
    const underground = App.game.underground;
    if (!mineState) return autoMineWait('Stopped');
    if (!underground.canAccess()) return autoMineWait('Waiting for Underground access');
    const mined = App.game.statistics.undergroundLayersMined();
    if (!questMineOwner && sellTreasureState && autoMineReservesValid && autoMineReserveInputsValid && layersMined !== undefined && mined > layersMined) {
        for (const item of UndergroundItems.list) {
            if (item.isSellable() && !item.sellLocked()) {
                const stock = player.itemList[item.itemName]?.();
                const reserve = Object.prototype.hasOwnProperty.call(autoMineSellReserves.items, item.itemName)
                    ? autoMineSellReserves.items[item.itemName] : autoMineSellReserves.default;
                const amount = Number.isSafeInteger(stock) ? Math.max(0, stock - reserve) : 0;
                if (amount > 0) {
                    UndergroundController.sellMineItem(item, amount);
                }
            }
        }
    }
    layersMined = mined;
    const mine = underground.mine;
    if (!mine) return autoMineWait('No mine — start a search in the game');
    if (mine.timeUntilDiscovery > 0) return autoMineWait(`Searching — ${Math.ceil(mine.timeUntilDiscovery)}s remaining`);
    if (mine.completed || mine.itemsFound >= mine.itemsBuried) return autoMineWait('Mine complete — waiting for the next mine');
    const battery = underground.battery;
    // Read the native save representation instead of modifying private animation state.
    // This also pauses tool use during a discharge started manually by the player.
    if (battery?.toJSON?.()?.activeDischargeID != null) {
        return autoMineWait('Battery discharging — waiting for animation', 100);
    }
    if (autoMineBatteryState && typeof battery?.canDischarge === 'function'
        && typeof battery.discharge === 'function' && battery.canDischarge()) {
        // The native check requires a full battery. Native discharge handles charge,
        // patterns, rewards, statistics and Oak item experience.
        battery.discharge();
        return autoMineWait('Battery discharging — waiting for animation', 100);
    }
    const tools = underground.tools;
    if (![UndergroundToolType.Chisel, UndergroundToolType.Hammer].some(type => tools.getTool(type)?.canUseTool())) {
        return autoMineWait('Tools recovering', autoMineRecoveryDelay(tools));
    }
    const action = chooseAutoMineAction(mine, tools);
    if (!action) return autoMineWait('No covered treasure target — waiting for the mine to update');
    const previousTool = tools.selectedToolType;
    try {
        tools.selectedToolType = action.type;
        // Retain the game's native click limit, durability checks and reward handling.
        UndergroundController.clickModalMineSquare(action.index);
    } finally {
        tools.selectedToolType = previousTool;
    }
    return autoMineWait('Mining', 50);
}

function autoMineRecoveryDelay(tools) {
    const delays = [UndergroundToolType.Chisel, UndergroundToolType.Hammer].map(type => {
        const tool = tools.getTool(type);
        const rate = tool?.restoreRatePerSecond?.();
        const missing = tool?.durabilityPerUse - tool?.durability;
        return rate > 0 && Number.isFinite(missing) ? Math.ceil(1000 * missing / rate) : 1000;
    });
    return Math.max(50, Math.min(1000, ...delays));
}

function chooseAutoMineAction(mine, tools) {
    const { grid, width, height } = mine;
    if (!Array.isArray(grid) || !Number.isInteger(width) || !Number.isInteger(height)
        || width <= 0 || height <= 0 || width * height !== grid.length) return null;
    const remaining = new Map();
    const targets = [];
    grid.forEach((tile, index) => {
        if (!tile.reward || tile.reward.rewarded || tile.layerDepth <= 0) return;
        const id = tile.reward.rewardID;
        remaining.set(id, (remaining.get(id) || 0) + tile.layerDepth);
        targets.push(index);
    });
    let best = null;
    for (const type of [UndergroundToolType.Chisel, UndergroundToolType.Hammer]) {
        const tool = tools.getTool(type);
        if (!tool?.canUseTool()) continue;
        const hammer = type === UndergroundToolType.Hammer;
        const candidates = new Set();
        for (const index of targets) {
            const x = index % width, y = Math.floor(index / width);
            const radius = hammer ? 1 : 0;
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height) {
                        candidates.add((y + dy) * width + x + dx);
                    }
                }
            }
        }
        // Cost is measured in Chisel uses. Free tools optimize useful work per click.
        const effort = tool.durabilityPerUse > 0 ? tool.durabilityPerUse / 0.02 : 1;
        for (const index of candidates) {
            const removed = new Map();
            const x = index % width, y = Math.floor(index / width);
            const radius = hammer ? 1 : 0;
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
                    const tile = grid[(y + dy) * width + x + dx];
                    if (!tile.reward || tile.reward.rewarded || tile.layerDepth <= 0) continue;
                    const id = tile.reward.rewardID;
                    removed.set(id, (removed.get(id) || 0) + Math.min(tile.layerDepth, hammer ? 1 : 2));
                }
            }
            let benefit = 0;
            for (const [id, depth] of removed) {
                // Reward progress and finishing bonuses break ties toward near-complete items.
                benefit += depth + 2 * depth / remaining.get(id) + (depth === remaining.get(id) ? 2 : 0);
            }
            const score = benefit / effort;
            if (score > 0 && (!best || score > best.score)) best = { type, index, score };
        }
    }
    return best;
}

function autoMineWait(status, delay = 1000) {
    if (questMineOwner) questMineStatus={status:'waiting',reason:status,nextWake:Date.now()+delay,progress:App.game.statistics.undergroundLayersMined()};
    updateAutoMineDisplay(status);
    return delay;
}

function startAutoMineSession() {
    autoMineSession = { start: performance.now(), items: App.game.statistics.undergroundItemsFound?.() ?? 0,
        layers: App.game.statistics.undergroundLayersMined() };
    autoMineLastRateUpdate = -Infinity;
}

function updateAutoMineDisplay(status, force = false) {
    const setText = (id, value) => {
        const element = document.getElementById(id);
        if (element && element.textContent !== value) element.textContent = value;
    };
    setText('auto-mine-status', status);
    const restart = typeof Settings !== 'undefined' ? Settings.getSetting('autoRestartUndergroundMine')?.observableValue() : undefined;
    const warnings = [];
    if (mineState && restart === false) warnings.push('Auto Restart is OFF — enable it in the game to continue after this mine.');
    if (sellTreasureState && (!autoMineReservesValid || !autoMineReserveInputsValid)) warnings.push('Sales paused — check Sale reserves.');
    setText('auto-mine-warning', warnings.join(' '));
    const now = performance.now();
    if (!force && now - autoMineLastRateUpdate < 1000) return;
    autoMineLastRateUpdate = now;
    if (!autoMineSession) {
        setText('auto-mine-rates', 'Start Auto Mine to measure this session.');
        return;
    }
    const elapsed = Math.max(0, (autoMineSession.end ?? now) - autoMineSession.start) / 60000;
    const found = autoMineSession.finalItems ?? App.game.statistics.undergroundItemsFound?.() ?? 0;
    const mined = autoMineSession.finalLayers ?? App.game.statistics.undergroundLayersMined();
    const items = Math.max(0, found - autoMineSession.items), layers = Math.max(0, mined - autoMineSession.layers);
    const rate = count => elapsed > 0 ? (count / elapsed).toFixed(1) : '0.0';
    setText('auto-mine-rates', `Session: ${items} treasures · ${rate(items)}/min · ${layers} layers · ${rate(layers)}/min`);
}

function validAutoMineReserve(value) {
    return Number.isSafeInteger(value) && value >= 0 && value <= 1000000000;
}

function loadAutoMineReserves() {
    const fallback = { default: 0, items: {} };
    const saved = localStorage.getItem('autoMineSellReserves');
    if (saved === null) return fallback;
    try {
        const value = JSON.parse(saved);
        if (value && validAutoMineReserve(value.default) && value.items && typeof value.items === 'object'
            && !Array.isArray(value.items) && Object.values(value.items).every(validAutoMineReserve)) return value;
    } catch { /* Preserve malformed storage until an explicit valid edit. */ }
    autoMineReservesValid = false;
    return fallback;
}

function initAutoMineReserveControls() {
    const defaults = document.getElementById('auto-mine-reserve-default');
    const select = document.getElementById('auto-mine-reserve-select');
    const override = document.getElementById('auto-mine-reserve-item');
    const message = document.getElementById('auto-mine-reserve-message');
    let editPending = false;
    defaults.value = autoMineSellReserves.default;
    for (const item of UndergroundItems.list.filter(item => item.isSellable())) {
        const option = document.createElement('option');
        option.value = item.itemName;
        option.textContent = item.displayName || item.itemName.replaceAll('_', ' ');
        select.append(option);
    }
    const showItem = () => {
        override.value = Object.prototype.hasOwnProperty.call(autoMineSellReserves.items, select.value)
            ? autoMineSellReserves.items[select.value] : '';
        override.disabled = !select.options.length;
        override.placeholder = `Default: ${autoMineSellReserves.default}`;
    };
    const validate = () => {
        const valid = defaults.value !== '' && validAutoMineReserve(defaults.valueAsNumber)
            && (override.value === '' && !override.validity.badInput || validAutoMineReserve(override.valueAsNumber));
        autoMineReserveInputsValid = valid && !editPending;
        message.textContent = !valid ? 'Sales paused: reserves must be whole numbers from 0 to 1,000,000,000.'
            : editPending ? 'Sales paused while editing reserves. Finish the field to apply.'
            : !autoMineReservesValid ? 'Sales paused: saved reserves are invalid. Set a valid reserve to resume.' : '';
        return valid;
    };
    const save = event => {
        if (!validate()) return;
        autoMineSellReserves.default = defaults.valueAsNumber;
        if (event.target === override && select.value) {
            if (override.value === '') delete autoMineSellReserves.items[select.value];
            else Object.defineProperty(autoMineSellReserves.items, select.value, { value: override.valueAsNumber, writable: true, enumerable: true, configurable: true });
        }
        localStorage.setItem('autoMineSellReserves', JSON.stringify(autoMineSellReserves));
        autoMineReservesValid = true;
        editPending = false;
        override.placeholder = `Default: ${autoMineSellReserves.default}`;
        validate();
    };
    const edit = () => { editPending = true; validate(); };
    defaults.addEventListener('input', edit);
    override.addEventListener('input', edit);
    defaults.addEventListener('change', save);
    override.addEventListener('change', save);
    // Returning to the original value emits no change event in browsers.
    const finishEdit = event => { if (editPending) save(event); };
    defaults.addEventListener('blur', finishEdit);
    override.addEventListener('blur', finishEdit);
    select.addEventListener('change', () => { showItem(); validate(); });
    showItem(); validate();
}

function toggleAutoMineBattery(event) {
    questMineOwner?.onManual('Manual mining settings');
    autoMineBatteryState = !autoMineBatteryState;
    event.currentTarget.classList.replace(...(autoMineBatteryState ? ['btn-danger', 'btn-success'] : ['btn-success', 'btn-danger']));
    event.currentTarget.textContent = `Auto Battery [${autoMineBatteryState ? 'ON' : 'OFF'}]`;
    event.currentTarget.setAttribute('aria-pressed', String(autoMineBatteryState));
    localStorage.setItem('autoMineBattery', autoMineBatteryState);
}

function autoSellTreasure(event) {
    questMineOwner?.onManual('Manual mining settings');
    sellTreasureState = !sellTreasureState;
    event.currentTarget.classList.replace(...(sellTreasureState ? ['btn-danger', 'btn-success'] : ['btn-success', 'btn-danger']));
    event.currentTarget.textContent = `Auto Sell Treasure [${sellTreasureState ? 'ON' : 'OFF'}]`;
    localStorage.setItem('autoSellTreasure', sellTreasureState);
}

function loadMineSetting(key, fallback) {
    try {
        const value = JSON.parse(localStorage.getItem(key));
        if (typeof value === typeof fallback) {
            return value;
        }
    } catch { /* Reset malformed settings only. */ }
    localStorage.setItem(key, fallback);
    return fallback;
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

if (!App.isUsingClient || (window.DesktopScriptHandler?.isEpheniaScriptEnabled('enhancedautomine') ?? (localStorage.getItem('enhancedautomine') === 'true'))) {
    loadEpheniaScript('enhancedautomine', initAutoMine);
}
