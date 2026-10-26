// ==UserScript==
// @name          [Pokeclicker] Optional Resources
// @namespace     Pokeclicker Scripts
// @author        Axxxxpirine (Dream Orb idea: EasyGoinGaming, PR #416)
// @description   Explicit resource grants and a bounded online Dream Orb bonus. OFF after every reload. Gains persist in your save.
// @license       GPL-3.0 License
// @version       1.0.0
// @homepageURL   https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/
// @supportURL    https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/issues
// @downloadURL   https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/codex/l5-custom-options/custom/optionalresources.user.js
// @updateURL     https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/codex/l5-custom-options/custom/optionalresources.user.js
// @match         https://www.pokeclicker.com/
// @grant         unsafeWindow
// @run-at        document-idle
// ==/UserScript==

class OptionalResources {
    static enabled = false;
    static timer = null;
    static elapsed = 0;
    static remaining = 0;

    static integer(value, max = 1e9) {
        if (!['string', 'number'].includes(typeof value) || String(value).trim() === '') return null;
        const n = Number(value);
        return Number.isSafeInteger(n) && n > 0 && n <= max ? n : null;
    }
    static game() { return typeof App === 'undefined' ? null : App.game; }
    static catalog(kind) {
        const game = this.game();
        if (!game) return [];
        switch (kind) {
            case 'currency':
                return (game.wallet?.currencies || []).flatMap((v, i) => typeof v === 'function' ? [[String(i), GameConstants.Currency[i]]] : []);
            case 'item': {
                if (typeof ItemList === 'undefined' || typeof UndergroundItems === 'undefined') return [];
                const names = [...new Set([...UndergroundItems.list.map(i => i.itemName), 'Key_stone'])];
                return names.filter(n => Object.hasOwn(ItemList, n) && typeof ItemList[n]?.gain === 'function').map(n => [n, n.replaceAll('_', ' ')]);
            }
            case 'berry':
                return typeof BerryType === 'undefined' ? [] : (game.farming?.berryInventory || []).flatMap((v, i) => typeof v === 'function' && BerryType[i] ? [[String(i), BerryType[i]]] : []);
            case 'orb':
                return (game.dreamOrbController?.orbs || []).map(o => [o.color, `${o.color} Dream Orb`]);
            case 'flow':
                return game.purifyChamber ? [['flow', 'Purification flow (native cap)']] : [];
            default: return [];
        }
    }
    static canAdd(current, amount) {
        return Number.isFinite(current) && current >= 0 && current + amount <= Number.MAX_SAFE_INTEGER && current + amount > current;
    }
    static grant(kind, key, input) {
        const amount = this.integer(input);
        if (!this.enabled || amount === null || !this.catalog(kind).some(([id]) => id === key)) return false;
        const game = this.game();
        let applied = amount;
        if (kind === 'currency') {
            const id = Number(key);
            if (!this.canAdd(game.wallet.currencies[id](), amount) || typeof game.wallet.addAmount !== 'function' || typeof Amount === 'undefined') return false;
            game.wallet.addAmount(new Amount(amount, id), true);
        } else if (kind === 'item') {
            if (typeof player === 'undefined' || typeof player.itemList[key] !== 'function' || !this.canAdd(player.itemList[key](), amount)) return false;
            const before = player.itemList[key]();
            ItemList[key].gain(amount);
            applied = player.itemList[key]() - before;
        } else if (kind === 'berry') {
            if (!this.canAdd(game.farming.berryInventory[Number(key)](), amount) || typeof BagHandler === 'undefined' || typeof ItemType === 'undefined') return false;
            BagHandler.gainItem({ type: ItemType.berry, id: Number(key) }, amount);
        } else if (kind === 'orb') {
            const orb = game.dreamOrbController.orbs.find(o => o.color === key);
            if (typeof orb.amount !== 'function' || !this.canAdd(orb.amount(), amount)) return false;
            orb.amount(orb.amount() + amount);
        } else if (kind === 'flow') {
            if (typeof PurifyChamber === 'undefined' || !PurifyChamber.requirements?.isCompleted()) return false;
            const chamber = game.purifyChamber;
            const current = chamber.currentFlow(), cap = chamber.flowNeeded();
            if (!this.canAdd(current, amount) || !Number.isSafeInteger(cap) || cap < 0) return false;
            chamber.currentFlow(Math.max(current, Math.min(current + amount, cap)));
            applied = chamber.currentFlow() - current;
        }
        this.status(`Applied ${applied.toLocaleString()} to ${key}${kind === 'flow' ? ' (limited to native flow cap)' : ''}. This change stays in your save.`);
        return true;
    }
    static eligibleOrbs() {
        return (this.game()?.dreamOrbController?.orbs || []).filter(o => typeof o.amount === 'function' && (!o.requirement || o.requirement.isCompleted()) && this.canAdd(o.amount(), 1));
    }
    static startOrbs(input) {
        const count = this.integer(input, 100);
        if (!this.enabled || count === null || !this.eligibleOrbs().length) return false;
        this.stopOrbs();
        this.remaining = count;
        this.last = performance.now();
        this.timer = setInterval(() => this.tickOrbs(), 1000);
        this.status(`Online Dream Orb bonus running: ${count} maximum, one per observed hour.`);
        return true;
    }
    static tickOrbs() {
        if (!this.enabled || !this.timer) return;
        const now = performance.now();
        const delta = now - this.last;
        this.last = now;
        // Long gaps and hidden tabs do not count as online play. Never award offline catch-up.
        if (document.visibilityState === 'hidden' || delta < 0 || delta > 5000) return;
        this.elapsed += delta;
        if (this.elapsed < 3600000) return;
        const orbs = this.eligibleOrbs();
        if (!orbs.length) { this.stopOrbs(); this.status('Stopped: no eligible Dream Orb.'); return; }
        const orb = orbs[Math.floor(Math.random() * orbs.length)];
        orb.amount(orb.amount() + 1);
        this.elapsed -= 3600000;
        this.remaining--;
        this.status(`Added one ${orb.color} Dream Orb. ${this.remaining} remaining.`);
        if (this.remaining <= 0) this.stopOrbs();
    }
    static stopOrbs() {
        if (this.timer !== null) clearInterval(this.timer);
        this.timer = null;
        this.elapsed = 0;
        this.remaining = 0;
    }
    static setEnabled(value) {
        this.enabled = value === true;
        if (!this.enabled) this.stopOrbs();
        const panel = document.getElementById('optional-resources');
        if (panel) {
            panel.querySelector('#resources-enabled').checked = this.enabled;
            panel.querySelectorAll('button:not(#resources-orbs-stop)').forEach(b => { b.disabled = !this.enabled; });
        }
        this.status(this.enabled ? 'Enabled for this session. Choose a resource and an exact quantity.' : 'OFF. Existing gains stay in the save.');
    }
    static status(message) {
        const el = document.getElementById('resources-status');
        if (el) el.textContent = message;
    }
    static init() {
        const root = document.getElementById('saveTab');
        if (!root || document.getElementById('optional-resources')) return;
        const panel = document.createElement('details');
        panel.id = 'optional-resources';
        panel.className = 'border rounded p-2 my-2';
        panel.innerHTML = `<summary>Optional resources · changes your save</summary>
            <p>Cheats are OFF after every reload. Added resources, statistics and resulting progression remain saved after disabling. Restore a backup to undo them. Export a save before use.</p>
            <label><input type="checkbox" id="resources-enabled"> Enable resource cheats for this session</label>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
                <label>Resource group<select id="resources-kind" class="form-control"><option value="currency">Currencies</option><option value="item">Mining items and Key Stone</option><option value="berry">Berries</option><option value="orb">Dream Orbs</option><option value="flow">Purification flow</option></select></label>
                <label>Resource<select id="resources-key" class="form-control" style="max-width:100%"></select></label>
                <label>Quantity (1–1,000,000,000)<input id="resources-amount" type="number" min="1" max="1000000000" step="1" value="1" class="form-control"></label>
                <button id="resources-grant" class="btn btn-warning" disabled>Add selected quantity</button>
            </div>
            <p>Flow needs the chamber unlocked and stops at its native cap. Key Stone is a direct grant, with no new mining item. Berry grants can unlock berries.</p>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
                <label>Maximum online Dream Orbs (1–100)<input id="resources-orbs-count" type="number" min="1" max="100" step="1" value="1" class="form-control"></label>
                <button id="resources-orbs-start" class="btn btn-warning" disabled>Start hourly bonus</button>
                <button id="resources-orbs-stop" class="btn btn-secondary">Stop bonus</button>
            </div>
            <p>One random unlocked orb per observed hour with the tab visible. Hidden or suspended time is excluded. Stop or reload discards partial progress.</p>
            <p id="resources-status" role="status" aria-live="polite"></p>`;
        root.prepend(panel);
        const byId = id => panel.querySelector(`#${id}`);
        const populate = () => {
            const select = byId('resources-key'); select.replaceChildren();
            for (const [value, label] of this.catalog(byId('resources-kind').value)) {
                const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option);
            }
        };
        byId('resources-kind').addEventListener('change', populate);
        byId('resources-enabled').addEventListener('change', e => this.setEnabled(e.target.checked));
        byId('resources-grant').addEventListener('click', () => {
            if (!this.grant(byId('resources-kind').value, byId('resources-key').value, byId('resources-amount').value)) this.status('Nothing changed. Check the quantity, resource availability and unlock requirements.');
        });
        byId('resources-orbs-start').addEventListener('click', () => {
            if (!this.startOrbs(byId('resources-orbs-count').value)) this.status('Bonus not started. Choose 1–100 orbs and enable cheats first.');
        });
        byId('resources-orbs-stop').addEventListener('click', () => { this.stopOrbs(); this.status('Online bonus stopped.'); });
        populate(); this.setEnabled(false);
        window.OptionalResources = this;
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


if (typeof App !== 'undefined' && (!App.isUsingClient || localStorage.getItem('optionalresources') === 'true')) {
    loadEpheniaScript('optionalresources', () => OptionalResources.init());
}
