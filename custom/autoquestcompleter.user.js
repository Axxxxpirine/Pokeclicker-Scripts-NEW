// ==UserScript==
// @name          [Pokeclicker] Auto Quest Completer
// @namespace     Pokeclicker Scripts
// @author        Optimatum (Credit: KarmaAlex, Ephenia)
// @description   Removes the limit for the number of quests you can do at once and auto completes/starts new ones.
// @copyright     https://github.com/Ephenia
// @license       GPL-3.0 License
// @version       2.1.2

// @homepageURL   https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/
// @supportURL    https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/issues
// @downloadURL   https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/autoquestcompleter.user.js
// @updateURL     https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/autoquestcompleter.user.js

// @match         https://www.pokeclicker.com/
// @icon          https://www.google.com/s2/favicons?domain=pokeclicker.com
// @grant         unsafeWindow
// @run-at        document-idle
// ==/UserScript==
// Modified by Axxxxpirine, 2026-10-27: fork maintenance and installation/update URLs.
// Includes this fork's compatibility and feature changes where applicable.
// Original authorship and GPL-3.0 licensing are retained.

function initAutoQuest() {
    /* Load settings */
    const questSubscriptions = [];
    var autoQuestEnabled = loadSetting('autoQuestEnabled', false);
    var maxQuests = loadSetting('autoQuestMaxQuests', 10);
    if (!(Number.isInteger(maxQuests) && 0 < maxQuests && maxQuests <= 10)) {
        maxQuests = 10;
    }
    var ignoredQuestTypes = loadSetting('autoQuestIgnoredQuestTypes', []);
    ignoredQuestTypes = ignoredQuestTypes.filter((type) => Object.keys(QuestHelper.quests).includes(type));
    var questResetTimer = loadSetting('autoQuestResetTimer', 10);
    if (!(Number.isInteger(questResetTimer) && questResetTimer > 0)) {
        questResetTimer = 10;
    }
    var questResetState = loadSetting('autoQuestResetState', false);
    var questResetTimeout;
    let refreshBudget = loadSetting('autoQuestRefreshBudget', 0);
    let moneyReserve = loadSetting('autoQuestMoneyReserve', 0);
    if (!Number.isSafeInteger(refreshBudget) || refreshBudget < 0) refreshBudget = 0;
    if (!Number.isSafeInteger(moneyReserve) || moneyReserve < 0) moneyReserve = 0;
    let refreshSpent = 0;
    let refreshing = false;
    let lastRefreshAttempt = -Infinity;

    createSettings();

    /* Initialize quest handling */

    overrideMethods();
    if (autoQuestEnabled) {
        refreshQuestSubscriptions();
    }

    /* Functions */

    function createSettings() {
        // Toggle buttons
        const autoQuestBtn = document.createElement('button');
        autoQuestBtn.id = 'toggle-auto-quest';
        autoQuestBtn.className = `btn btn-block btn-${autoQuestEnabled ? 'success' : 'danger'}`;
        autoQuestBtn.style = 'position: absolute; left: 0px; top: 0px; width: auto; height: 41px; font-size: 9px;';
        autoQuestBtn.textContent = `Auto [${autoQuestEnabled ? 'ON' : 'OFF'}]`;
        autoQuestBtn.addEventListener('click', () => { toggleAutoQuest(); })
        document.getElementById('questDisplayContainer').appendChild(autoQuestBtn);

        const questResetBtn = document.createElement('button');
        questResetBtn.id = 'toggle-auto-quest-reset';
        questResetBtn.className = `btn btn-block btn-${questResetState ? 'success' : 'danger'}`;
        questResetBtn.style = 'width: auto; height: 41px; font-size: 12px;';
        questResetBtn.textContent = `${questResetTimer} minute Reset Timer [${questResetState ? 'ON' : 'OFF'}]`;
        questResetBtn.addEventListener('click', () => { toggleQuestResetState(); });
        document.getElementById('questDisplayContainer').appendChild(questResetBtn);

        // Add settings to scripts tab
        const settingsBody = createScriptSettingsContainer('Auto Quest Completer');
        let maxQuestsElem = document.createElement('tr');
        maxQuestsElem.innerHTML = `<td class="p-2 col-md-8">Max quest slots</td><td class="p-0 col-md-4"><select id="select-autoQuestMaxQuests" class="form-control">` +
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => `<option value="${i}">${i}</option>`).join('\n') + `</select></td>`;
        let maxSelect = maxQuestsElem.querySelector('#select-autoQuestMaxQuests');
        maxSelect.value = maxQuests;
        maxSelect.addEventListener('change', (event) => { changeMaxQuests(event); })
        settingsBody.appendChild(maxQuestsElem);
        let resetTimerElem = document.createElement('tr');
        resetTimerElem.innerHTML = '<td class="p-2 col-md-8">Quest reset timer (in minutes)</td><td class="p-0 col-md-4"><div style="display:flex;">' +
            '<input id="input-autoQuestResetTimer" type="text" placeholder="0 to disable" class="form-control">' +
            '<button id="input-autoQuestResetTimer-submit" class="btn btn-block btn-success" style="font-size: 8pt; flex: 0; min-width: 25%;">OK</button></div></td>';
        resetTimerElem.querySelector('#input-autoQuestResetTimer').value = questResetTimer;
        resetTimerElem.querySelector('#input-autoQuestResetTimer-submit').addEventListener('click', () => { changeQuestResetTimer(); })
        settingsBody.appendChild(resetTimerElem);
        
        for (const [key, label, value] of [
            ['autoQuestRefreshBudget', 'Paid refresh money budget per session (0 = free only)', refreshBudget],
            ['autoQuestMoneyReserve', 'Money reserve after a paid refresh', moneyReserve],
        ]) {
            const row = document.createElement('tr');
            row.innerHTML = `<td class="p-2"><label for="input-${key}">${label}</label></td><td class="p-2"><input id="input-${key}" class="form-control" type="number" min="0" step="1"></td>`;
            const input = row.querySelector('input'); input.value = value;
            input.addEventListener('change', () => {
                const next = Number(input.value);
                if (!Number.isSafeInteger(next) || next < 0) { input.value = key === 'autoQuestRefreshBudget' ? refreshBudget : moneyReserve; return; }
                if (key === 'autoQuestRefreshBudget') refreshBudget = next; else moneyReserve = next;
                localStorage.setItem(key, JSON.stringify(next));
            });
            settingsBody.appendChild(row);
        }
        const refreshStatus = document.createElement('tr');
        refreshStatus.innerHTML = '<td colspan="2" id="auto-quest-budget-status" role="status">Paid refresh spent: 0. Budget resets when Auto is started or the game reloads.</td>';
        settingsBody.appendChild(refreshStatus);

        // Quest types filtering
        let info = document.createElement('tr');
        info.innerHTML = `<td class="p-2" colspan="2"><label class="m-0">Preferred quest types</label></td>`;
        settingsBody.appendChild(info);
        info = document.createElement('tr');
        info.innerHTML = `<td class="p-2" colspan="2"><label class="m-0">(Auto Quests will refresh once all preferred quests are complete)</label></td>`;
        settingsBody.appendChild(info);
        Object.keys(QuestHelper.quests).forEach((type) => {
            let elem = document.createElement('tr');
            elem.innerHTML = `<td class="p-2"><label class="m-0 col-md-8" for="checkbox-autoQuestTypes-${type}">${GameConstants.camelCaseToString(type)}</label></td>` + 
                `<td class="p-2 col-md-4"><input id="checkbox-autoQuestTypes-${type}" type="checkbox"></td>`;
            let checkbox = elem.querySelector(`#checkbox-autoQuestTypes-${type}`);
            checkbox.checked = !ignoredQuestTypes.includes(type);
            checkbox.addEventListener('change', () => { toggleIgnoreQuestType(type); });
            settingsBody.appendChild(elem);
        });
    }

    function toggleAutoQuest() {
        autoQuestEnabled = !autoQuestEnabled;
        if (autoQuestEnabled) {
            refreshSpent = 0;
            refreshQuestSubscriptions();
        } else {
            clearQuestSubscriptions();
        }
        if (!autoQuestEnabled && questResetState) {
            toggleQuestResetState();
        }
        const autoQuestBtn = document.getElementById('toggle-auto-quest');
        autoQuestBtn.classList.replace(...(autoQuestEnabled ? ['btn-danger', 'btn-success'] : ['btn-success', 'btn-danger']));
        autoQuestBtn.textContent = `Auto [${autoQuestEnabled ? 'ON' : 'OFF'}]`;
        localStorage.setItem('autoQuestEnabled', autoQuestEnabled);
    }

    function changeMaxQuests(event) {
        const newVal = +event.target.value;
        if (Number.isInteger(newVal) && 0 < newVal && newVal <= 10) {
            maxQuests = newVal;
            localStorage.setItem('autoQuestMaxQuests', maxQuests);
            beginQuests();
        }
    }

    function toggleQuestResetState() {
        questResetState = !questResetState;
        resetQuestResetTimeout();
        const questResetBtn = document.getElementById('toggle-auto-quest-reset');
        questResetBtn.classList.replace(...(questResetState ? ['btn-danger', 'btn-success'] : ['btn-success', 'btn-danger']));
        questResetBtn.textContent = `${questResetTimer} minute Reset Timer [${questResetState ? 'ON' : 'OFF'}]`;
        localStorage.setItem('autoQuestResetState', questResetState);
    }

    function changeQuestResetTimer() {
        const form = document.getElementById('input-autoQuestResetTimer');
        let val = +form.value;
        val = (Number.isInteger(val) && val > 0 ? val : 10);
        form.value = val;
        if (val != questResetTimer) {
            questResetTimer = val;
            resetQuestResetTimeout();
            document.getElementById('toggle-auto-quest-reset').textContent = `${questResetTimer} minute Reset Timer [${questResetState ? 'ON' : 'OFF'}]`;
            localStorage.setItem('autoQuestResetTimer', questResetTimer);
        }
    }

    function toggleIgnoreQuestType(type) {
        let i = ignoredQuestTypes.indexOf(type);
        if (i >= 0) {
            ignoredQuestTypes.splice(i, 1);
        } else {
            ignoredQuestTypes.push(type);
        }
        localStorage.setItem('autoQuestIgnoredQuestTypes', JSON.stringify(ignoredQuestTypes));
    }

    function refreshQuestSubscriptions() {
        // Dispose of old subscriptions
        clearQuestSubscriptions();

        // Subscribe to new quests
        App.game.quests.questList().forEach((quest, i) => {
            if (quest.isCompleted() && !quest.claimed() && !quest.autoComplete) {
                // Claim quest if already done
                App.game.quests.claimQuest(i);
            } else if (!quest.isCompleted()){
                // Subscribe to in-progress quests
                const sub = quest.isCompleted.subscribe(() => {
                    if (!quest.autoComplete && quest.inProgress() && quest.isCompleted()) {
                        App.game.quests.claimQuest(i);
                        beginQuests();
                        sub.dispose();
                    }
                });
                questSubscriptions.push(sub);
            }
        });

        beginQuests(false);
        resetQuestResetTimeout();
    }

    function clearQuestSubscriptions() {
        for (const sub of questSubscriptions) {
            sub.dispose();
        }
        questSubscriptions.length = 0;
    }

    function resetQuestResetTimeout() {
        clearTimeout(questResetTimeout);
        if (autoQuestEnabled && questResetState) {
            questResetTimeout = setTimeout(() => {
                requestQuestRefresh();
                resetQuestResetTimeout();
            }, questResetTimer * GameConstants.MINUTE);
        }
    }

    function requestQuestRefresh() {
        if (!autoQuestEnabled || refreshing || Date.now() - lastRefreshAttempt < 1000) return false;
        const free = App.game.quests.freeRefresh();
        const cost = free ? 0 : App.game.quests.getRefreshCost().amount;
        const wallet = App.game.wallet.currencies[GameConstants.Currency.money]();
        if (!Number.isFinite(cost) || cost < 0 || (cost > 0 && (refreshSpent + cost > refreshBudget || wallet - cost < moneyReserve))) {
            document.getElementById('auto-quest-budget-status').textContent = `Refresh paused: budget or reserve. Paid refresh spent: ${refreshSpent}.`;
            return false;
        }
        lastRefreshAttempt = Date.now();
        refreshSpent += cost;
        refreshing = true;
        try {
            // Native refresh can be async. Keep the guard until it settles.
            const result = App.game.quests.refreshQuests(free, false);
            if (result?.then) result.catch(error => console.error('[Auto Quests]', error)).finally(() => { refreshing = false; });
            else refreshing = false;
        } catch (error) { refreshing = false; console.error('[Auto Quests]', error); }
        document.getElementById('auto-quest-budget-status').textContent = `Paid refresh spent: ${refreshSpent} / ${refreshBudget}.`;
        return true;
    }

    function beginQuests(allowRefresh = true) {
        if (!autoQuestEnabled) return;
        var preferredQuests = [];
        var ignoredQuests = [];
        App.game.quests.incompleteQuests().forEach((quest) => {
            if (!quest.inProgress() && !quest.isCompleted()) {
                let i = App.game.quests.questList.indexOf(quest);
                if (!ignoredQuestTypes.includes(quest.constructor.name)) {
                    preferredQuests.push(i);
                } else {
                    ignoredQuests.push(i);
                }
            }
        });
        // Add allowed quests before ignored quests
        let indices = preferredQuests.concat(ignoredQuests);
        for (let i of indices) {
            if (!App.game.quests.canStartNewQuest()) {
                break;
            }
            App.game.quests.beginQuest(i);
        }

        if (!App.game.quests.incompleteQuests().some((quest) => !ignoredQuestTypes.includes(quest.constructor.name))) {
            // Only filtered quests left
            if (allowRefresh && ignoredQuestTypes.length < Object.keys(QuestHelper.quests).length) {
                requestQuestRefresh();
            }
        }
    }

    function overrideMethods() {
        const generateQuestListOld = App.game.quests.generateQuestList;
        App.game.quests.generateQuestList = function(...args) {
            const res = generateQuestListOld.apply(this, ...args);
            if (autoQuestEnabled) {
                refreshQuestSubscriptions();
            }
            return res;
        }

        App.game.quests.canStartNewQuest = function() {
            // Check we haven't already used up all quest slots
            if (this.currentQuests().length >= maxQuests) {
                return false;
            }

            // Check at least 1 quest is either not completed or in progress
            if (this.questList().some(quest => !quest.isCompleted() && !quest.inProgress())) {
                return true;
            }

            return false;
        }
    }
}

function loadSetting(key, defaultVal) {
    var val;
    try {
        val = JSON.parse(localStorage.getItem(key));
        if (val == null || typeof val !== typeof defaultVal || (typeof val == 'object' && val.constructor.name !== defaultVal.constructor.name)) {
            throw new Error;
        }
    } catch {
        val = defaultVal;
        localStorage.setItem(key, JSON.stringify(defaultVal));
    }
    return val;
}

/**
 * Creates container for scripts settings in the settings menu, adding scripts tab if it doesn't exist yet
 */
function createScriptSettingsContainer(name) {
    const settingsID = name.replaceAll(/s/g, '').toLowerCase();
    var settingsContainer = document.getElementById('settings-scripts-container');

    // Create scripts settings tab if it doesn't exist yet
    if (!settingsContainer) {
        // Fixes the Scripts nav item getting wrapped to the bottom by increasing the max width of the window
        document.querySelector('#settingsModal div').style.maxWidth = '850px';
        // Create and attach script settings tab link
        const settingTabs = document.querySelector('#settingsModal ul.nav-tabs');
        const li = document.createElement('li');
        li.classList.add('nav-item');
        li.innerHTML = `<a class="nav-link" href="#settings-scripts" data-toggle="tab">Scripts</a>`;
        settingTabs.appendChild(li);
        // Create and attach script settings tab contents
        const tabContent = document.querySelector('#settingsModal .tab-content');
        scriptSettings = document.createElement('div');
        scriptSettings.classList.add('tab-pane');
        scriptSettings.setAttribute('id', 'settings-scripts');
        tabContent.appendChild(scriptSettings);
        settingsContainer = document.createElement('div');
        settingsContainer.setAttribute('id', 'settings-scripts-container');
        scriptSettings.appendChild(settingsContainer);
    }

    // Create settings container
    const settingsTable = document.createElement('table');
    settingsTable.classList.add('table', 'table-striped', 'table-hover', 'm-0');
    const header = document.createElement('thead');
    header.innerHTML = `<tr><th colspan="2">${name}</th></tr>`;
    settingsTable.appendChild(header);
    const settingsBody = document.createElement('tbody');
    settingsBody.setAttribute('id', `settings-scripts-${settingsID}`);
    settingsTable.appendChild(settingsBody);

    // Insert settings container in alphabetical order
    let settingsList = Array.from(settingsContainer.children);
    let insertBefore = settingsList.find(elem => elem.querySelector('tbody').id > `settings-scripts-${settingsID}`);
    if (insertBefore) {
        insertBefore.before(settingsTable);
    } else {
        settingsContainer.appendChild(settingsTable);
    }

    return settingsBody;
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

if (!App.isUsingClient || (window.DesktopScriptHandler?.isEpheniaScriptEnabled('autoquestcompleter') ?? (localStorage.getItem('autoquestcompleter') === 'true'))) {
    loadEpheniaScript('autoquestcompleter', initAutoQuest);
}
