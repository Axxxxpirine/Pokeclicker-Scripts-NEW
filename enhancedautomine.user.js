// ==UserScript==
// @name          [Pokeclicker] Enhanced Auto Mine
// @namespace     Pokeclicker Scripts
// @author        Ephenia (Credit: falcon71, KarmaAlex, umbralOptimatum, Pastaficionado)
// @description   Automatically mines the Underground with Chisel and Hammer. Optional treasure selling, compatible with Pokéclicker 0.10.26.
// @copyright     https://github.com/Ephenia
// @license       GPL-3.0 License
// @version       3.0.0

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
var sellTreasureState = loadMineSetting('autoSellTreasure', false);
var autoMineTimer;
var layersMined;

function initAutoMine() {
    if (document.getElementById('auto-mine-start')) {
        return;
    }
    const controls = document.createElement('div');
    controls.className = 'mb-2';
    controls.innerHTML = `<div class="d-flex flex-wrap">
        <button id="auto-mine-start" class="btn btn-${mineState ? 'success' : 'danger'}">Auto Mine [${mineState ? 'ON' : 'OFF'}]</button>
        <button id="auto-sell-treasure" class="btn btn-${sellTreasureState ? 'success' : 'danger'}">Auto Sell Treasure [${sellTreasureState ? 'ON' : 'OFF'}]</button>
        </div><small>Uses Chisel and Hammer as durability recovers. Enable the game's Auto Restart to continue to the next mine. Energy restores and layer skipping were removed from the game. Bombs are avoided to preserve treasures.</small>`;
    document.querySelector('#mineModal .modal-body').prepend(controls);
    document.getElementById('auto-mine-start').addEventListener('click', startAutoMine);
    document.getElementById('auto-sell-treasure').addEventListener('click', autoSellTreasure);
    layersMined = App.game.statistics.undergroundLayersMined();
    updateAutoMineTimer();
}

function updateAutoMineTimer() {
    clearInterval(autoMineTimer);
    autoMineTimer = undefined;
    if (mineState) {
        autoMineTimer = setInterval(doAutoMine, 1000);
    }
}

function startAutoMine(event) {
    mineState = !mineState;
    event.currentTarget.classList.replace(...(mineState ? ['btn-danger', 'btn-success'] : ['btn-success', 'btn-danger']));
    event.currentTarget.textContent = `Auto Mine [${mineState ? 'ON' : 'OFF'}]`;
    localStorage.setItem('autoMineState', mineState);
    updateAutoMineTimer();
}

function doAutoMine() {
    const underground = App.game.underground;
    if (!mineState || !underground.canAccess()) {
        return;
    }
    const mined = App.game.statistics.undergroundLayersMined();
    if (sellTreasureState && layersMined !== undefined && mined > layersMined) {
        for (const item of UndergroundItems.list) {
            if (item.isSellable() && !item.sellLocked()) {
                const amount = player.itemList[item.itemName]();
                if (amount > 0) {
                    UndergroundController.sellMineItem(item, amount);
                }
            }
        }
    }
    layersMined = mined;
    const mine = underground.mine;
    if (!mine || mine.timeUntilDiscovery > 0 || mine.completed || mine.itemsFound >= mine.itemsBuried) {
        return;
    }
    const target = mine.grid.findIndex(tile => tile.reward && !tile.reward.rewarded && tile.layerDepth > 0);
    if (target < 0) {
        return;
    }
    // At most one action per tick. Let the game handle durability, rewards and restart.
    const tools = underground.tools;
    const toolType = [UndergroundToolType.Chisel, UndergroundToolType.Hammer]
        .find(type => tools.getTool(type)?.canUseTool());
    if (toolType === undefined) {
        return;
    }
    const previousTool = tools.selectedToolType;
    try {
        tools.selectedToolType = toolType;
        UndergroundController.clickModalMineSquare(target);
    } finally {
        tools.selectedToolType = previousTool;
    }
}

function autoSellTreasure(event) {
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

if (!App.isUsingClient || localStorage.getItem('enhancedautomine') === 'true') {
    loadEpheniaScript('enhancedautomine', initAutoMine);
}
