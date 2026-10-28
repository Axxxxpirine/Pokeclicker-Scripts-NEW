// ==UserScript==
// @name          [Pokeclicker] Simple Auto Farmer
// @namespace     Pokeclicker Scripts
// @author        Ephenia / Akwawa / perkasthor / davide-lugli (update 1.6) / Optimatum
// @description   Adds options to automatically plant, harvest, replant, and remulch. Unlike harvesting, replanting only harvests berries right before they wither, to maximize any auras. Make sure the correct berry is selected before auto planting; the script will save your selection across restarts. Auto replant and mulch maintain the berry/mulch already in each plot. Optional wanderer capture, a stop timer, manual mutation plans and bounded pre-maturity Rich Mulch share the farm loop.
// @copyright     https://github.com/Ephenia
// @license       GPL-3.0 License
// @version       1.9.6

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
    // Spending modes require a fresh opt-in after loading. Their plans/settings persist.
    let planState = false;
    let richState = false;
    let richUsed = 0;
    localStorage.setItem('autoFarmPlanState', false);
    localStorage.setItem('autoFarmRichState', false);
    const farming = App.game.farming;
    const plotCount = Math.min(25, farming.plotList.length);
    const validBerry = id => Number.isInteger(id) && id >= 0 && typeof farming.berryInventory?.[id] === 'function'
        && typeof BerryType !== 'undefined' && typeof BerryType[id] === 'string';
    function readSaved(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    }
    function boundedSetting(key, fallback, min, max) {
        const value = readSaved(key, fallback);
        return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
    }
    const savedPlan = readSaved('autoFarmMutationPlan', []);
    const mutationPlan = Array.from({length: plotCount}, (_, index) => Array.isArray(savedPlan) && validBerry(savedPlan[index]) ? savedPlan[index] : -1);
    let planReserve = boundedSetting('autoFarmPlanReserve', 10, 0, 1000000000);
    let richReserve = boundedSetting('autoFarmRichReserve', 10, 0, 1000000000);
    let richCap = boundedSetting('autoFarmRichCap', 25, 1, 10000);
    let richSeconds = boundedSetting('autoFarmRichSeconds', 30, 1, 3600);
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

    let questOwner = null, questStatus = {status:'ready',reason:'',progress:0,nextWake:0};
    const questWindow = !App.isUsingClient ? unsafeWindow : window;
    const registry = questWindow.PokeAutomationAdapters ||= {version:1,adapters:Object.create(null),movementOwner:null};
    const validQuestOwner = owner => owner === questOwner && owner?.active && owner.isCurrent();
    // Availability is objective-specific and read fresh, never latched to the last apply.
    const berryAvailability = berryType => {
        if (typeof farming.canAccess === 'function' && !farming.canAccess())
            return {status:'blocked',reason:'Farm access locked'};
        const usable = farming.plotList.slice(0,plotCount).filter((plot,index) => plot?.isUnlocked
            && !plot.isSafeLocked && !validBerry(mutationPlan[index]));
        const growing = usable.some(plot => plot.berry !== -1 && (berryType == null || plot.berry === berryType));
        const reserve = planState ? planReserve : 0;
        const stock = berryType == null ? farming.berryInventory.some(n=>n() > reserve)
            : farming.berryInventory[berryType]?.() > reserve;
        if (growing) return {status:'waiting',reason:'Waiting for natural berry growth'};
        if (!stock) return {status:'blocked',reason:'Requested berry stock absent, no supported native acquisition available'};
        return usable.some(plot=>plot.berry === -1) ? {status:'ready'}
            : usable.length ? {status:'waiting',reason:'Waiting for current crops to mature before planting the requested berry'}
            : {status:'blocked',reason:'No usable farm plot for the requested berry'};
    };
    registry.adapters.farm = {
        inspect:() => ({...questStatus,activities:[{id:'farm:points',target:{kind:'farm'},
            unlocked:true,...berryAvailability(),capabilities:['farmPoints'],rates:{}},
            ...Array.from(farming.berryInventory,(_,berryType)=>({
            id:`farm:${berryType}`,target:{kind:'farm'},berryType,unlocked:true,...berryAvailability(berryType),
            capabilities:['berries'],rates:{}}))]}),
        acquire(owner) { if (questOwner && questOwner !== owner) return false; questOwner=owner; return true; },
        apply(owner, objective) {
            if (!validQuestOwner(owner)) return false;
            if (typeof farming.canAccess === 'function' && !farming.canAccess()) {
                questStatus={status:'blocked',reason:'Farm access locked',nextWake:Date.now()+1000};return true;
            }
            const berry = validBerry(objective.berryType) ? objective.berryType
                : farming.berryInventory.findIndex(stock=>stock() > (planState ? planReserve : 0));
            let progress=0;
            for (let index=0; index<plotCount; index++) {
                const plot=farming.plotList[index];
                // Designated mutation plots remain commitments even while the mode is OFF.
                if (!plot || !plot.isUnlocked || plot.isSafeLocked || validBerry(mutationPlan[index])) continue;
                // Quest progress starts on acceptance. Prepare its crop now,
                // but leave the requested berries for the accepted harvest.
                if (objective.harvestReady === false && plot.berry === berry) continue;
                if (plot.berry !== -1) {
                    // Transition only at maturity, and only with stock to replace unrelated crops.
                    const canReplace = validBerry(berry) && farming.berryInventory[berry]() > (planState ? planReserve : 0);
                    if ((objective.berryType == null || plot.berry === berry || canReplace) && typeof PlotStage !== 'undefined' && plot.stage?.() === PlotStage.Berry) {
                        farming.harvest(index);progress++;
                    }
                }
                if (plot.berry === -1 && validBerry(berry) && farming.berryInventory[berry]() > (planState ? planReserve : 0)) {
                    farming.plant(index,berry);
                }
            }
            const availability=berryAvailability(objective.berryType);
            questStatus={...availability,status:availability.status === 'blocked' ? 'blocked':'waiting',progress,
                reason:availability.reason || 'Waiting for natural berry growth',nextWake:Date.now()+1000};
            return true;
        },
        release(owner) {if (questOwner === owner) {questOwner=null;questStatus={status:'ready',progress:0,nextWake:0};}}
    };
    createMenu();
    // All explicit farm controls yield ownership before their existing handlers run.
    for (const element of document.querySelectorAll('#auto-farm-controls button,#auto-farm-controls input,#auto-farm-controls select')) {
        if (element.tagName === 'BUTTON' || element.tagName === 'INPUT' || element.tagName === 'SELECT') {
            for (const event of ['click','change']) element.addEventListener(event,()=>questOwner?.onManual('Manual farm control'),true);
        }
    }
    checkFarmDeadline();
    toggleFarmLoop();

    function createMenu() {
        var elemAF = document.createElement("div");
        elemAF.id = "auto-farm-controls";
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
        createPlanMenu(elemAF);
    }

    function createPlanMenu(host) {
        const panel = document.createElement('details');
        panel.className = 'py-2';
        panel.innerHTML = `<summary>Mutation plan and Rich Mulch</summary>
            <p class="small">Manual 5×5 plan, matching the farm from top left to bottom right. Choose parent berries and leave mutation spaces untouched. Existing plants are never removed. The plan switches Auto Plant, Harvest and Replant off. Farmhands remain independent.</p>
            <div id="auto-farm-plan-grid" style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px"></div>
            <div id="auto-farm-plan-settings" class="py-2"></div>
            <button id="auto-farm-plan-toggle" type="button" class="btn btn-sm btn-danger">Mutation plan [OFF]</button>
            <p id="auto-farm-plan-status" class="small" role="status">Settings are saved. Enable the plan each session.</p>
            <hr><p class="small">Apply one Rich Mulch to an unmulched plant shortly before maturity. Locked plots and other mulch are left untouched. Auto Mulch and this mode are mutually exclusive. The cap resets only when you enable this mode again.</p>
            <div id="auto-farm-rich-settings"></div>
            <button id="auto-farm-rich-toggle" type="button" class="btn btn-sm btn-danger">Rich Mulch [OFF]</button>
            <span id="auto-farm-rich-status" class="small" role="status"></span>`;
        host.appendChild(panel);
        const grid = document.getElementById('auto-farm-plan-grid');
        for (let index = 0; index < plotCount; index++) {
            const label = document.createElement('label');
            label.className = 'small mb-0';
            label.textContent = `Plot ${index + 1}`;
            const select = document.createElement('select');
            select.id = `auto-farm-plan-${index}`;
            select.dataset.farmPlanPlot = index;
            select.className = 'form-control form-control-sm';
            select.add(new Option('Leave untouched', '-1'));
            for (let berry = 0; berry < (farming.berryInventory?.length ?? 0); berry++) {
                if (validBerry(berry)) select.add(new Option(BerryType[berry], String(berry)));
            }
            select.value = mutationPlan[index];
            select.onchange = () => {
                const berry = Number(select.value);
                if (select.value !== '' && (berry === -1 || validBerry(berry))) {
                    mutationPlan[index] = berry;
                    localStorage.setItem('autoFarmMutationPlan', JSON.stringify(mutationPlan));
                } else select.value = mutationPlan[index];
            };
            label.appendChild(select);
            grid.appendChild(label);
        }
        const numberInput = (parent, id, title, key, value, min, max, save) => {
            const label = document.createElement('label');
            label.className = 'small mr-2';
            label.textContent = `${title} `;
            const input = document.createElement('input');
            Object.assign(input, {id, type: 'number', min, max, step: 1, value});
            input.style.width = '95px';
            input.onchange = () => {
                const next = Number(input.value);
                if (input.value.trim() === '' || !Number.isSafeInteger(next) || next < min || next > max) {
                    input.value = value;
                    return;
                }
                value = next;
                save(next);
                localStorage.setItem(key, next);
                updateRichStatus();
            };
            label.appendChild(input);
            document.getElementById(parent).appendChild(label);
        };
        numberInput('auto-farm-plan-settings', 'auto-farm-plan-reserve', 'Keep each berry', 'autoFarmPlanReserve', planReserve, 0, 1000000000, value => planReserve = value);
        numberInput('auto-farm-rich-settings', 'auto-farm-rich-seconds', 'Seconds before maturity', 'autoFarmRichSeconds', richSeconds, 1, 3600, value => richSeconds = value);
        numberInput('auto-farm-rich-settings', 'auto-farm-rich-reserve', 'Keep Rich Mulch', 'autoFarmRichReserve', richReserve, 0, 1000000000, value => richReserve = value);
        numberInput('auto-farm-rich-settings', 'auto-farm-rich-cap', 'Units per activation', 'autoFarmRichCap', richCap, 1, 10000, value => richCap = value);
        document.getElementById('auto-farm-plan-toggle').onclick = () => {
            if (!planState) {
                if (plantState) autoPlantToggle();
                if (harvestState) autoHarvestToggle();
                if (replantState) autoReplantToggle();
            }
            setPlanState(!planState);
        };
        document.getElementById('auto-farm-rich-toggle').onclick = () => {
            if (!richState) {
                if (mulchState) autoMulchToggle();
                richUsed = 0;
            }
            setRichState(!richState);
        };
        updateRichStatus();
    }

    function setPlanState(enabled) {
        planState = enabled;
        localStorage.setItem('autoFarmPlanState', enabled);
        const button = document.getElementById('auto-farm-plan-toggle');
        button.textContent = `Mutation plan [${enabled ? 'ON' : 'OFF'}]`;
        button.className = `btn btn-sm btn-${enabled ? 'success' : 'danger'}`;
        toggleFarmLoop();
    }

    function setRichState(enabled) {
        richState = enabled;
        localStorage.setItem('autoFarmRichState', enabled);
        const button = document.getElementById('auto-farm-rich-toggle');
        button.textContent = `Rich Mulch [${enabled ? 'ON' : 'OFF'}]`;
        button.className = `btn btn-sm btn-${enabled ? 'success' : 'danger'}`;
        updateRichStatus();
        toggleFarmLoop();
    }

    function updateRichStatus() {
        document.getElementById('auto-farm-rich-status').textContent = `${richUsed}/${richCap} units used${richUsed >= richCap ? ' — cap reached' : ''}`;
    }

    function doMutationPlan() {
        if (typeof farming.plant !== 'function' || (typeof farming.canAccess === 'function' && !farming.canAccess())) return;
        let planted = 0;
        for (let index = 0; index < plotCount; index++) {
            const plot = farming.plotList[index];
            const berry = mutationPlan[index];
            if (!validBerry(berry) || !plot || plot.isUnlocked !== true || plot.isSafeLocked || plot.berry !== -1) continue;
            const stock = farming.berryInventory[berry]();
            if (!Number.isSafeInteger(stock) || stock <= planReserve) continue;
            farming.plant(index, berry);
            if (plot.berry === berry) planted++;
        }
        document.getElementById('auto-farm-plan-status').textContent = `${planted} planted this check. Occupied, protected and unassigned plots left untouched. Berry reserve: ${planReserve}.`;
    }

    function doRichMulch() {
        if (typeof MulchType.Rich_Mulch !== 'number' || typeof farming.addMulch !== 'function'
            || typeof farming.getGrowthMultiplier !== 'function' || typeof farming.getMulchDurationMultiplier !== 'function'
            || typeof GameConstants === 'undefined' || (typeof farming.canAccess === 'function' && !farming.canAccess())) return;
        const mulch = MulchType.Rich_Mulch;
        const inventory = farming.mulchList?.[mulch];
        if (typeof inventory !== 'function') return;
        const duration = GameConstants.MULCH_USE_TIME * farming.getMulchDurationMultiplier();
        if (!Number.isFinite(duration) || duration <= 0) return;
        for (let index = 0; index < plotCount && richUsed < richCap; index++) {
            const plot = farming.plotList[index];
            if (!plot || plot.isUnlocked !== true || plot.isSafeLocked || plot.berry < 0 || plot.mulch !== MulchType.None) continue;
            const maturity = plot.berryData?.growthTime?.[3];
            const speed = typeof plot.getGrowthMultiplier === 'function' ? farming.getGrowthMultiplier() * plot.getGrowthMultiplier() : NaN;
            if (!Number.isFinite(maturity) || !Number.isFinite(plot.age) || !Number.isFinite(speed) || speed <= 0) continue;
            const secondsLeft = (maturity - plot.age) / speed;
            if (secondsLeft <= 0 || secondsLeft > richSeconds || secondsLeft >= duration) continue;
            const stock = inventory();
            if (!Number.isSafeInteger(stock) || stock <= richReserve) break;
            if (typeof farming.canMulch === 'function' && !farming.canMulch(index, mulch)) continue;
            farming.addMulch(index, mulch, 1);
            const spent = stock - inventory();
            if (Number.isFinite(spent) && spent > 0) richUsed += spent;
        }
        updateRichStatus();
    }

    function toggleFarmLoop() {
        if (plantState || replantState || harvestState || mulchState || catchState || planState || richState || stopAt) {
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
            setPlanState(false);
            setRichState(false);
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
        if (questOwner) return;
        // Check wall-clock time before any action, including after sleep or reload.
        if (checkFarmDeadline()) return;
        if (catchState) {
            for (const plot of App.game.farming.plotList) {
                if (plot.wanderer) App.game.farming.handleWanderer(plot);
            }
        }
        if (richState) doRichMulch();
        if (planState) {
            doMutationPlan();
        } else if (replantState) {
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
        if (plantState && planState) setPlanState(false);
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
        if (harvestState && planState) setPlanState(false);
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
        if (replantState && planState) setPlanState(false);
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
        if (mulchState && richState) setRichState(false);
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

if (!App.isUsingClient || (window.DesktopScriptHandler?.isEpheniaScriptEnabled('simpleautofarmer') ?? (localStorage.getItem('simpleautofarmer') === 'true'))) {
    loadEpheniaScript('simpleautofarmer', initAutoFarm, initSelectedBerryTracking);
}
