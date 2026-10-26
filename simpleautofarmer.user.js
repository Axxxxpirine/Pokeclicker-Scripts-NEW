// ==UserScript==
// @name          [Pokeclicker] Simple Auto Farmer
// @namespace     Pokeclicker Scripts
// @author        Ephenia / Akwawa / perkasthor / davide-lugli (update 1.6) / Optimatum
// @description   Adds options to automatically plant, harvest, replant, and remulch. Unlike harvesting, replanting only harvests berries right before they wither, to maximize any auras. Make sure the correct berry is selected before auto planting; the script will save your selection across restarts. Auto replant and mulch maintain the berry/mulch already in each plot. Optional wanderer capture and a persistent stop timer share the farm loop.
// @copyright     https://github.com/Ephenia
// @license       GPL-3.0 License
// @version       1.8.0

// @homepageURL   https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/
// @supportURL    https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/issues
// @downloadURL   https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/simpleautofarmer.user.js
// @updateURL     https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/simpleautofarmer.user.js

// @match         https://www.pokeclicker.com/
// @icon          https://www.google.com/s2/favicons?domain=pokeclicker.com
// @grant         unsafeWindow
// @run-at        document-idle
// ==/UserScript==//
// Fork compatibility update, 2026-10-26: fixes for Pokéclicker 0.10.26.
// Wanderer capture inspired by CatapultingWizard (upstream PR #433).
// Farm stop timer inspired by EasyGoinGaming (upstream PR #416), independently adapted for persistence.


function initAutoFarm() {
    var autoFarmLoop;

    var plantState;
    var harvestState;
    var replantState;
    var mulchState;
    var catchState;
    var stopAt = JSON.parse(localStorage.getItem('autoFarmStopAt'));
    if (!Number.isSafeInteger(stopAt) || stopAt < 0) {
        stopAt = 0;
        localStorage.setItem('autoFarmStopAt', 0);
    }

    plantState = JSON.parse(localStorage.getItem('autoPlantState'));
    harvestState = JSON.parse(localStorage.getItem('autoHarvestState'));
    replantState = JSON.parse(localStorage.getItem('autoReplantState'));
    mulchState = JSON.parse(localStorage.getItem('autoMulchState'));
    catchState = JSON.parse(localStorage.getItem('autoCatchState'));

    let plantSelected = JSON.parse(localStorage.getItem('autoPlantSelected'));
    FarmController.selectedBerry(plantSelected);
    FarmController.navigateIndex(Math.floor(plantSelected / FarmController.BERRIES_PER_PAGE));

    createMenu();
    checkFarmDeadline();
    toggleFarmLoop();

    function createMenu() {
        var elemAF = document.createElement("div");
        var divMenu1 = document.createElement("div");
        var divMenu2 = document.createElement("div");
        var divMenu3 = document.createElement("div");
        const shovelList = document.getElementById('shovelList');

        divMenu1.className = "row justify-content-center py-0";
        divMenu2.className = "row justify-content-center py-0";

        elemAF.appendChild(divMenu1);
        elemAF.appendChild(divMenu2);
        divMenu3.className = divMenu2.className;
        elemAF.appendChild(divMenu3);
        shovelList.before(elemAF);

        const createButton = (name, state, func, rl, row) => {
            var buttonDiv = document.createElement('div');
            buttonDiv.className = `col-6 p${rl}-0`;

            var button = document.createElement('button');
            button.setAttribute('id', `auto-${name}-toggle`);
            button.className = 'btn btn-block btn-' + (state ? 'success' : 'danger');
            button.style.height = '50px';
            button.style.fontSize = '9pt';
            button.textContent = `Auto ${name[0].toUpperCase() + name.slice(1)}\n[${state ? 'ON' : 'OFF'}]`;
            button.onclick = function() { func(); };

            buttonDiv.appendChild(button);
            row.appendChild(buttonDiv);
        }

        createButton('plant', plantState, autoPlantToggle, 'r', divMenu1);
        createButton('harvest', harvestState, autoHarvestToggle, 'l', divMenu1);
        createButton('replant', replantState, autoReplantToggle, 'r', divMenu2);
        createButton('mulch', mulchState, autoMulchToggle, 'l', divMenu2);
        createButton('catch', catchState, autoCatchToggle, 'r', divMenu3);
        const timerControls = document.createElement('div');
        timerControls.className = 'd-flex flex-wrap align-items-center py-2';
        timerControls.style.gap = '6px';
        timerControls.innerHTML = `<label for="auto-farm-minutes" class="mb-0">Stop farm after (minutes)</label>
            <input id="auto-farm-minutes" type="number" min="1" max="10080" step="1" class="form-control form-control-sm" style="width:90px">
            <button id="auto-farm-timer-start" type="button" class="btn btn-sm btn-primary">Start timer</button>
            <button id="auto-farm-timer-cancel" type="button" class="btn btn-sm btn-secondary">Cancel timer</button>
            <span id="auto-farm-timer-status" role="status"></span>`;
        elemAF.appendChild(timerControls);
        const minutesInput = document.getElementById('auto-farm-minutes');
        const savedMinutes = JSON.parse(localStorage.getItem('autoFarmTimerMinutes'));
        minutesInput.value = Number.isInteger(savedMinutes) && savedMinutes >= 1 && savedMinutes <= 10080 ? savedMinutes : 60;
        document.getElementById('auto-farm-timer-start').onclick = () => {
            const minutes = Number(minutesInput.value);
            if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) {
                document.getElementById('auto-farm-timer-status').textContent = 'Enter 1–10080 whole minutes. Existing timer unchanged.';
                return;
            }
            stopAt = Date.now() + minutes * 60000;
            localStorage.setItem('autoFarmStopAt', stopAt);
            localStorage.setItem('autoFarmTimerMinutes', minutes);
            checkFarmDeadline();
            toggleFarmLoop();
        };
        document.getElementById('auto-farm-timer-cancel').onclick = () => {
            stopAt = 0;
            localStorage.setItem('autoFarmStopAt', 0);
            checkFarmDeadline();
            toggleFarmLoop();
        };
    }

    function toggleFarmLoop() {
        if (plantState || replantState || harvestState || mulchState || catchState || stopAt) {
            if (!autoFarmLoop) {
                autoFarmLoop = setInterval(autoFarmTick, 1000);
            }
        } else {
            autoFarmLoop = clearInterval(autoFarmLoop);
        }
    }

    function checkFarmDeadline() {
        const status = document.getElementById('auto-farm-timer-status');
        if (stopAt && Date.now() >= stopAt) {
            plantState = harvestState = replantState = mulchState = catchState = false;
            stopAt = 0;
            localStorage.setItem('autoFarmStopAt', 0);
            for (const name of ['plant', 'harvest', 'replant', 'mulch', 'catch']) {
                localStorage.setItem(`auto${name[0].toUpperCase() + name.slice(1)}State`, false);
                const button = document.getElementById(`auto-${name}-toggle`);
                button.textContent = `Auto ${name[0].toUpperCase() + name.slice(1)}\n[OFF]`;
                button.classList.replace('btn-success', 'btn-danger');
            }
            toggleFarmLoop();
            status.textContent = 'Timer expired. All farm modes OFF.';
            return true;
        }
        const seconds = Math.max(0, Math.ceil((stopAt - Date.now()) / 1000));
        status.textContent = stopAt ? `Time left: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'Timer OFF';
        return false;
    }

    function autoCatchToggle() {
        catchState = !catchState;
        localStorage.setItem('autoCatchState', catchState);
        const button = document.getElementById('auto-catch-toggle');
        button.textContent = `Auto Catch\n[${catchState ? 'ON' : 'OFF'}]`;
        button.classList.replace(...(catchState ? ['btn-danger', 'btn-success'] : ['btn-success', 'btn-danger']));
        toggleFarmLoop();
    }

    function autoFarmTick() {
        // Check wall-clock time before any action, including after sleep or reload.
        if (checkFarmDeadline()) return;
        if (catchState) {
            for (const plot of App.game.farming.plotList) {
                if (plot.wanderer) App.game.farming.handleWanderer(plot);
            }
        }
        if (replantState) {
            doReplant();
        } else {
            if (harvestState) {
                doHarvest();
            }
            if (plantState) {
                doPlant();
            }
        }
        if (mulchState) {
            doMulch();
        }
    }

    function autoPlantToggle() {
        plantState = !plantState;
        localStorage.setItem("autoPlantState", plantState);
        toggleFarmLoop();
        if (replantState) {
            autoReplantToggle();
        }
        let elt = document.getElementById('auto-plant-toggle');
        if (plantState) {
            elt.innerText = "Auto Plant\n[ON]";
            elt.classList.remove('btn-danger');
            elt.classList.add('btn-success');
        } else {
            elt.innerText = "Auto Plant\n[OFF]";
            elt.classList.remove('btn-success');
            elt.classList.add('btn-danger');
        }
    }

    function doPlant() {
        App.game.farming.plantAll(FarmController.selectedBerry());
    }

    function autoHarvestToggle() {
        harvestState = !harvestState;
        localStorage.setItem("autoHarvestState", harvestState);
        toggleFarmLoop();
        if (replantState) {
            autoReplantToggle();
        }
        let elt = document.getElementById('auto-harvest-toggle');
        if (harvestState) {
            elt.innerText = "Auto Harvest\n[ON]";
            elt.classList.remove('btn-danger');
            elt.classList.add('btn-success');
        } else {
            elt.innerText = "Auto Harvest\n[OFF]";
            elt.classList.remove('btn-success');
            elt.classList.add('btn-danger');
        }
    }

    function doHarvest() {
        App.game.farming.harvestAll();
    }

    function autoReplantToggle() {
        replantState = !replantState;
        localStorage.setItem("autoReplantState", replantState);
        toggleFarmLoop();
        if (plantState) {
            autoPlantToggle();
        }
        if (harvestState) {
            autoHarvestToggle();
        }
        let elt = document.getElementById('auto-replant-toggle');
        if (replantState) {
            elt.innerText = "Auto Replant\n[ON]";
            elt.classList.remove('btn-danger');
            elt.classList.add('btn-success');
        } else {
            elt.innerText = "Auto Replant\n[OFF]";
            elt.classList.remove('btn-success');
            elt.classList.add('btn-danger');
        }
    }

    function doReplant() {
        // Check each tile
        for (let i = 0; i < 25; i++) {
            let plot = App.game.farming.plotList[i];
            let berry = plot.berry;
            if (berry >= 0) {
                // Auto-harvest tiles with surprise mulch
                if (plot.mulch == MulchType.Surprise_Mulch) {
                    App.game.farming.harvest(i, false);
                    continue;
                }
                var timeLeft = plot.berryData.growthTime[4] - plot.age;
                timeLeft /= (App.game.farming.getGrowthMultiplier() * plot.getGrowthMultiplier());
                if (timeLeft < 10) {
                    App.game.farming.harvest(i, false);
                    App.game.farming.plant(i, berry, false);
                }
            }
        }
    }

    function autoMulchToggle() {
        mulchState = !mulchState;
        localStorage.setItem("autoMulchState", mulchState);
        toggleFarmLoop();
        let elt = document.getElementById('auto-mulch-toggle');
        if (mulchState) {
            elt.innerText = "Auto Mulch\n[ON]";
            elt.classList.remove('btn-danger');
            elt.classList.add('btn-success');
        } else {
            elt.innerText = "Auto Mulch\n[OFF]";
            elt.classList.remove('btn-success');
            elt.classList.add('btn-danger');
        }
    }

    // Add more of same kind of mulch
    function doMulch() {
        for (let i = 0; i < 25; i++) {
            var plot = App.game.farming.plotList[i];
            if (plot.mulch != MulchType.None && plot.mulchTimeLeft < 15) {
                App.game.farming.addMulch(i, plot.mulch);
            }
        }
    }
}

function initSelectedBerryTracking() {
    let berryEntry = document.getElementById('seeds').querySelector('li[data-bind*="selectedBerry"]');
    let bound = berryEntry.getAttribute('data-bind');
    bound = bound.replace(`click: function() {`, `click: function() {localStorage.setItem('autoPlantSelected', $data);`);
    berryEntry.setAttribute('data-bind', bound);

    const navigateLeft = FarmController.navigateLeft.bind(FarmController);
    const navigateRight = FarmController.navigateRight.bind(FarmController);
    FarmController.navigateLeft = function() {
        var result = navigateLeft();
        localStorage.setItem('autoPlantSelected', FarmController.selectedBerry());
        return result;
    }
    FarmController.navigateRight = function() {
        var result = navigateRight();
        localStorage.setItem('autoPlantSelected', FarmController.selectedBerry());
        return result;
    }
}

function initLocalStorage(param, value) {
    let curVal = localStorage.getItem(param);
    try {
        curVal = JSON.parse(curVal);
    } catch (e) {
        curVal = null;
    }
    if (curVal == null || (typeof curVal !== typeof value)) {
        localStorage.setItem(param, value);
    }
}

initLocalStorage("autoPlantState", false);
initLocalStorage("autoHarvestState", false);
initLocalStorage("autoReplantState", false);
initLocalStorage("autoMulchState", false);
initLocalStorage("autoPlantSelected", 0);
initLocalStorage("autoCatchState", false);
initLocalStorage("autoFarmStopAt", 0);
initLocalStorage("autoFarmTimerMinutes", 60);

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

if (!App.isUsingClient || localStorage.getItem('simpleautofarmer') === 'true') {
    loadEpheniaScript('simpleautofarmer', initAutoFarm, initSelectedBerryTracking);
}
