// ==UserScript==
// @name          [Pokeclicker] Auto Quest Runner
// @namespace     Pokeclicker Scripts
// @author        Axxxxpirine (Ideas: goldhaxx #431, Bowbylone/Dionisos94 #240, Sorrow #134)
// @description   Session-only quest automation controls with shared adapters and manual interruption.
// @license       GPL-3.0 License
// @version       1.1.1
// @homepageURL   https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/
// @supportURL    https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/issues
// @downloadURL   https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/autoquestrunner.user.js
// @updateURL     https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/autoquestrunner.user.js
// @match         https://www.pokeclicker.com/
// @grant         unsafeWindow
// @run-at        document-idle
// ==/UserScript==

class AutoQuestRunner {
    static version = 1;
    static active = false;
    static acquired = [];
    static registry() {
        const w = !App.isUsingClient ? unsafeWindow : window;
        return w.PokeAutomationAdapters ||= {version:1, adapters:Object.create(null), movementOwner:null};
    }
    static init() {
        const w = !App.isUsingClient ? unsafeWindow : window;
        w.AutoQuestRunner = this;
        this.registry();
        if (document.getElementById('auto-quest-runner')) return;
        const button = document.createElement('button');
        button.id = 'auto-quest-runner'; button.className = 'btn btn-secondary'; button.textContent = 'Auto Quests: OFF';
        button.addEventListener('click', () => this.active ? this.stop('Stopped') : this.start());
        document.querySelector('.battle-view')?.before(button);
    }
    static start(names = ['navigation']) {
        if (this.active) return false;
        const registry = this.registry();
        if (registry.version !== 1 || names.some(name => !registry.adapters[name])) return false;
        this.active = true;
        const owner = {active:true, isCurrent:() => owner.active && this.active && this.owner === owner,
            onManual:reason => { if (owner.isCurrent()) this.stop(reason); }};
        this.owner = owner; this.acquired = [];
        try {
            for (const name of new Set(names)) {
                const adapter = registry.adapters[name];
                if (!adapter.acquire(owner)) { this.stop('Module busy'); return false; }
                this.acquired.push({name, adapter});
            }
        } catch (error) { this.stop(error.message); return false; }
        this.render(); return true;
    }
    static apply(name, objective) {
        if (!this.owner?.isCurrent()) return false;
        return this.acquired.find(entry => entry.name === name)?.adapter.apply(this.owner, objective) ?? false;
    }
    static stop(reason = 'Stopped') {
        if (!this.active) return;
        this.owner.active = false; this.active = false;
        for (const {adapter} of this.acquired.reverse()) {
            try { adapter.release(this.owner, reason); } catch (error) { console.error('[Auto Quest Runner]', error); }
        }
        this.acquired = []; this.reason = reason; this.render();
    }
    static render() {
        const button = document.getElementById('auto-quest-runner');
        if (button) button.textContent = `Auto Quests: ${this.active ? 'ON' : 'OFF'}`;
    }
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

if (!App.isUsingClient || (window.DesktopScriptHandler?.isEpheniaScriptEnabled('autoquestrunner') ?? (localStorage.getItem('autoquestrunner') === 'true'))) {
    loadEpheniaScript('autoquestrunner', () => AutoQuestRunner.init());
}
