// ==UserScript==
// @name          [Pokeclicker] Auto Navigation
// @namespace     Pokeclicker Scripts
// @author        Axxxxpirine (Ideas: goldhaxx #431, Bowbylone/Dionisos94 #240, Sorrow #134)
// @description   Bounded route, gym, dungeon and quest objectives with manual interruption, return, and Poké Mart budgets. Requires the fork's Enhanced Auto Clicker.
// @license       GPL-3.0 License
// @version       1.0.0
// @homepageURL   https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW
// @supportURL    https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/issues
// @downloadURL   https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/autonavigation.user.js
// @updateURL     https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/autonavigation.user.js
// @match         https://www.pokeclicker.com/
// @grant         unsafeWindow
// @run-at        document-idle
// ==/UserScript==

class AutoNavigator {
    static active = false;
    static internal = false;
    static modes = {
        routes: 'Route defeats (total)', gyms: 'Gym wins (total)', dungeons: 'Dungeon clears (total)',
        dungeonRuns: 'Current dungeon: additional clears', capture: 'Capture species (ID)',
        routePokerus: 'Route Pokérus resistance', dungeonPokerus: 'Dungeon Pokérus resistance',
        quests: 'Active location quests', shop: 'Buy to stock target', frontier: 'Visit Battle Frontier',
        roamer: 'Capture roaming species (ID)', purify: 'Purify Shadow Pokémon (native flow)',
    };
    static defaults = { mode: 'routes', target: 10000, moneyBudget: 0, tokenBudget: 0,
        moneyReserve: 0, tokenReserve: 0, minutes: 60, stallMinutes: 5, pokemon: '', item: 'Pokeball', stock: 100 };
    static shopItems = ['Pokeball', 'Greatball', 'Ultraball', 'Lucky_egg', 'Lucky_incense', 'xAttack', 'xClick', 'Token_collector'];

    static init() {
        if (document.getElementById('auto-navigation')) return;
        const w = !App.isUsingClient ? unsafeWindow : window;
        w.AutoNavigator = this;
        let saved;
        try { saved = JSON.parse(localStorage.getItem('autoNavigationSettings')); } catch { /* use defaults */ }
        this.settings = this.valid(saved) ? saved : {...this.defaults};
        this.installMovementHooks();
        const panel = document.createElement('details');
        panel.id = 'auto-navigation';
        panel.className = 'border rounded p-2 mb-1';
        panel.innerHTML = `<summary>Auto Navigation</summary>
            <div class="d-flex flex-wrap" style="gap:6px" id="auto-navigation-fields"></div>
            <div class="d-flex mt-2" style="gap:6px"><button class="btn btn-success" id="navigation-start">Start</button>
            <button class="btn btn-secondary" id="navigation-stop">Stop & return</button></div>
            <div role="status" id="navigation-status">OFF · Money and token budgets default to zero. Active sessions never resume after reload.</div>
            <small>Requires Enhanced Auto Clicker. Manual travel or clicker toggles cancel without returning. Capture uses your existing ball filters. Shop buys only at base price, returning to your starting route while prices recover. Unavailable or stalled targets are skipped. Budgets cover this session's entries and purchases only.</small>`;
        document.querySelector('.battle-view').before(panel);
        const fields = panel.querySelector('#auto-navigation-fields');
        const add = (key, label, options) => {
            const wrap = document.createElement('label');
            wrap.style = 'flex:1 1 145px;min-width:0;margin:0';
            wrap.textContent = label;
            const input = document.createElement(options ? 'select' : 'input');
            input.id = `navigation-${key}`; input.className = 'form-control';
            if (options) {
                for (const [value, text] of Object.entries(options)) {
                    const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option);
                }
            } else { input.type = 'number'; input.min = ['target','stock','minutes','stallMinutes'].includes(key) ? '1' : '0'; input.step = key === 'pokemon' ? 'any' : '1'; }
            input.value = this.settings[key]; wrap.append(input); fields.append(wrap);
        };
        add('mode', 'Objective', this.modes);
        for (const [key,label] of Object.entries({target:'Target count',pokemon:'Species ID (capture)',stock:'Target stock',moneyBudget:'Money budget / session',tokenBudget:'Token budget / session',moneyReserve:'Keep money reserve',tokenReserve:'Keep token reserve',minutes:'Session limit (minutes)',stallMinutes:'Skip after no progress (minutes)'})) add(key,label);
        add('item','Shop item',Object.fromEntries(this.shopItems.map(n=>[n,n.replaceAll('_',' ')])));
        document.getElementById('navigation-start').addEventListener('click', () => {
            const settings = {};
            for (const key of Object.keys(this.defaults)) {
                const value = document.getElementById(`navigation-${key}`).value;
                settings[key] = ['mode','pokemon','item'].includes(key) ? value : Number(value);
            }
            this.start(settings);
        });
        document.getElementById('navigation-stop').addEventListener('click', () => this.stop('Stopped',true));
    }

    static valid(s) {
        return s && Object.hasOwn(this.modes,s.mode) && this.shopItems.includes(s.item) && typeof s.pokemon === 'string'
            && ['target','stock','minutes','stallMinutes'].every(k => Number.isSafeInteger(s[k]) && s[k] >= 1)
            && s.minutes <= 1440 && s.stallMinutes <= 1440
            && ['moneyBudget','tokenBudget','moneyReserve','tokenReserve'].every(k => Number.isSafeInteger(s[k]) && s[k] >= 0)
            && (!['capture','roamer'].includes(s.mode) || (/^\d+(\.\d+)?$/.test(s.pokemon) && Number(s.pokemon) > 0));
    }

    static status(message) {
        this.message = message;
        const el = document.getElementById('navigation-status');
        if (el) el.textContent = message;
    }

    static own(fn) {
        const wasInternal = this.internal; this.internal = true;
        try { return fn(); } finally { this.internal = wasInternal; }
    }

    static installMovementHooks() {
        const owner = this;
        for (const name of ['moveToRoute','moveToTown']) {
            const original = MapHelper[name];
            MapHelper[name] = function(...args) {
                if (owner.active && !owner.internal) owner.stop('Manual or external travel',false,true);
                return original.apply(this,args);
            };
        }
        // Only won/lost transitions belong to the controller. A manual dungeonLeave
        // also calls returnToTown, but must cancel instead of paying for another run.
        for (const name of ['dungeonWon', 'dungeonLost']) {
            const original = DungeonRunner[name];
            DungeonRunner[name] = function(...args) {
                if (owner.active && owner.current?.kind === 'dungeon' && DungeonRunner.dungeonID === owner.runId) {
                    return owner.own(() => original.apply(this,args));
                }
                return original.apply(this,args);
            };
        }
    }

    static abandonDungeon() {
        if (this.current?.kind !== 'dungeon' || DungeonRunner.dungeonID !== this.runId) return;
        // Match native leave semantics. A pending boss catch may finish, but must
        // not later award a clear or pull the player back after leaving.
        DungeonRunner.dungeonFinished(true);
        DungeonRunner.fighting(false);
        DungeonRunner.fightingBoss(false);
        DungeonRunner.defeatedBoss(null);
    }

    static location() {
        return player.route ? {kind:'route',number:player.route,region:player.region}
            : {kind:'town',name:player.town.name,region:player.region};
    }

    static accessible(t) {
        if (t.region < 0 || t.region > player.highestRegion()) return false;
        if (t.kind === 'route') return !!MapHelper.accessToRoute(t.number,t.region);
        if (!TownList[t.name] || !MapHelper.accessToTown(t.name)) return false;
        if (t.kind === 'dungeon') return !!TownList[t.name].dungeon?.isUnlocked() && TownList[t.name].dungeon.hasUnlockedBoss() && !DungeonGuides.hired();
        if (t.kind === 'gym') return !!GymList[t.gym]?.isUnlocked();
        return true;
    }

    static move(t) {
        if (!this.accessible(t)) return false;
        this.own(() => t.kind === 'route' ? MapHelper.moveToRoute(t.number,t.region) : MapHelper.moveToTown(t.name));
        const loc = this.location();
        return t.kind === 'route' ? loc.kind === 'route' && loc.number === t.number && loc.region === t.region : loc.kind === 'town' && loc.name === t.name;
    }

    static start(settings) {
        if (!this.valid(settings)) { this.status('Invalid settings. Counts and budgets must be finite whole numbers.'); return false; }
        const w = !App.isUsingClient ? unsafeWindow : window;
        const clicker = w.EnhancedAutoClicker || (typeof EnhancedAutoClicker !== 'undefined' ? EnhancedAutoClicker : null);
        if (!clicker || clicker.navigationVersion !== 1) { this.status('Install the fork’s updated Enhanced Auto Clicker first.'); return false; }
        if (this.active) this.stop('Restarted',true);
        if (![GameConstants.GameState.town,GameConstants.GameState.fighting].includes(App.game.gameState) || DungeonGuides.hired() || DungeonBattle.catching()) {
            this.status('Start from a route or town with Dungeon Guides stopped.'); return false;
        }
        if (settings.mode === 'dungeonRuns' && !player.town?.dungeon || settings.mode === 'dungeonRuns' && player.route) {
            this.status('Select a dungeon town first.'); return false;
        }
        if (['capture','roamer'].includes(settings.mode) && !pokemonMap[Number(settings.pokemon)]) {
            this.status('Unknown species ID.'); return false;
        }
        this.settings = {...settings}; localStorage.setItem('autoNavigationSettings',JSON.stringify(this.settings));
        this.clicker = clicker; clicker.navigationOwner = this;
        this.origin = this.location();
        this.snapshot = {click:clicker.autoClickState(),gym:clicker.autoGymState(),dungeon:clicker.autoDungeonState()};
        this.own(() => {
            if (clicker.autoGymState()) clicker.toggleAutoGym();
            if (clicker.autoDungeonState()) clicker.toggleAutoDungeon();
            if (!clicker.autoClickState()) clicker.toggleAutoClick();
        });
        // A reload must not restart any unattended spending loop.
        for (const key of ['autoClickState','autoGymState','autoDungeonState']) localStorage.setItem(key,'false');
        this.purified = 0; this.spent = {money:0,dungeonToken:0}; this.skipped = new Set(); this.current = null;
        this.deadline = Date.now()+settings.minutes*60000; this.nextPlanAt = 0;
        this.questIds = new WeakMap(); this.nextQuestId = 0;
        this.startClears = settings.mode === 'dungeonRuns' ? this.clears({kind:'dungeon',name:this.origin.name}) : 0;
        this.active = true;
        this.tick(true);
        return true;
    }

    static stop(reason = 'Stopped', returnHome = true, abandon = returnHome) {
        if (!this.active) return;
        if (abandon) this.abandonDungeon();
        this.active = false;
        const c = this.clicker;
        this.own(() => {
            GymRunner.autoRestart(false);
            if (c.autoDungeonState()) c.toggleAutoDungeon();
            if (c.autoGymState()) c.toggleAutoGym();
            const returned = returnHome && this.move(this.origin);
            if (returned) {
                if (this.snapshot.gym && c.canStartAutoGym()) c.toggleAutoGym();
                if (this.snapshot.dungeon && c.canStartAutoDungeon()) c.toggleAutoDungeon();
            }
            if (c.autoClickState() !== this.snapshot.click) c.toggleAutoClick();
            // toggle methods may not have run when the values already matched.
            localStorage.setItem('autoClickState',String(c.autoClickState()));
            localStorage.setItem('autoGymState',String(c.autoGymState()));
            localStorage.setItem('autoDungeonState',String(c.autoDungeonState()));
            if (returnHome && !returned) reason += ' · Original location no longer accessible';
        });
        this.status(`${reason} · Spent ${this.spent.money} money, ${this.spent.dungeonToken} tokens · ${this.skipped.size} skipped`);
        this.current = null;
    }

    static routes() {
        return Routes.regionRoutes.map(r=>({kind:'route',region:r.region,number:r.number,key:`r:${r.region}:${r.number}`})).filter(t=>this.accessible(t));
    }
    static dungeons() {
        return Object.values(TownList).filter(t=>t.dungeon).map(t=>({kind:'dungeon',name:t.name,region:t.region,key:`d:${t.name}`})).filter(t=>this.accessible(t));
    }
    static gyms() {
        return Object.entries(GymList).filter(([,g])=>g.parent).map(([name,g])=>({kind:'gym',name:g.parent.name,gym:name,region:g.parent.region,key:`g:${name}`})).filter(t=>this.accessible(t));
    }
    static clears(t) {
        if (t.kind === 'route') return App.game.statistics.routeKills[t.region][t.number]();
        if (t.kind === 'gym') return App.game.statistics.gymsDefeated[GameConstants.getGymIndex(t.gym)]();
        return App.game.statistics.dungeonsCleared[GameConstants.getDungeonIndex(t.name)]();
    }
    static species(t) {
        // Native methods include currently fulfilled special/date/weather conditions, not raw species lists.
        return t.kind === 'route' ? RouteHelper.getAvailablePokemonList(t.number,t.region,false)
            : TownList[t.name].dungeon.allAvailablePokemon();
    }
    static needsResistance(name) { return App.game.party.getPokemonByName(name)?.pokerus === GameConstants.Pokerus.Contagious; }
    static remaining(t) {
        const mode = this.settings.mode;
        if (mode === 'purify') return this.purified < this.settings.target && App.game.party.caughtPokemon.some(p=>p.shadow === GameConstants.ShadowStatus.Shadow);
        if (t.quest) return !t.quest.isCompleted() && App.game.quests.currentQuests().includes(t.quest);
        if (mode.includes('Pokerus')) return this.species(t).some(n=>this.needsResistance(n));
        if (mode === 'capture' || mode === 'roamer') {
            const name = pokemonMap[Number(this.settings.pokemon)].name;
            return !App.game.party.getPokemonByName(name) && (mode === 'roamer' ? this.roamers(t).some(r=>r.pokemon.name===name) : this.species(t).includes(name));
        }
        if (mode === 'shop') return this.shopItem()?.getBagAmount() < this.settings.stock;
        if (mode === 'frontier') return true;
        return this.clears(t) < (mode === 'dungeonRuns' ? this.startClears + this.settings.target : this.settings.target);
    }
    static progress(t) {
        if (this.settings.mode === 'purify') return App.game.purifyChamber.currentFlow() + this.purified;
        if (t.quest) return Number(t.quest.focus?.() ?? 0);
        if (this.settings.mode.includes('Pokerus')) return this.species(t).reduce((n,name)=>n+(App.game.party.getPokemonByName(name)?.effortPoints ?? 0),0);
        if (['capture','roamer'].includes(this.settings.mode)) return Number(!!App.game.party.getPokemonByName(pokemonMap[Number(this.settings.pokemon)].name));
        if (this.settings.mode === 'shop') return this.shopItem().getBagAmount();
        if (this.settings.mode === 'frontier') return 0;
        return this.clears(t);
    }
    static roamers(t) {
        return RoamingPokemonList.getSubRegionalGroupRoamers(t.region,RoamingPokemonList.findGroup(t.region,Routes.getRoute(t.region,t.number).subRegion || 0));
    }
    static shopItem() { return ItemList[this.settings.item]; }
    static candidates() {
        const mode = this.settings.mode;
        if (mode === 'purify') return PurifyChamber.requirements.isCompleted() ? [{...this.origin,key:'purify'}] : [];
        if (['routes','routePokerus','roamer'].includes(mode)) return this.routes();
        if (['dungeons','dungeonPokerus'].includes(mode)) return this.dungeons();
        if (mode === 'gyms') return this.gyms();
        if (mode === 'capture') return [...this.routes(),...this.dungeons()];
        if (mode === 'dungeonRuns') return this.dungeons().filter(t=>t.name===this.origin.name);
        if (mode === 'frontier') return [{kind:'town',name:'Battle Frontier',region:TownList['Battle Frontier']?.region,key:'frontier'}];
        if (mode === 'shop') {
            const item = this.shopItem();
            if (!item || !item.isAvailable() || item.isSoldOut()) return [];
            return Object.values(TownList).filter(t=>t.content.some(s=>s instanceof Shop && s.isUnlocked() && s.items.includes(item)))
                .map(t=>({kind:'shop',name:t.name,region:t.region,key:`shop:${t.name}`}));
        }
        if (mode === 'quests') return App.game.quests.currentQuests().flatMap(q=> {
            if (!this.questIds.has(q)) this.questIds.set(q,++this.nextQuestId);
            let target;
            if (q.constructor.name === 'DefeatPokemonsQuest') target = {kind:'route',region:q.region,number:q.route};
            if (q.constructor.name === 'DefeatDungeonQuest') target = this.dungeons().find(t=>t.name===q.dungeon);
            if (q.constructor.name === 'DefeatGymQuest') target = this.gyms().find(t=>t.gym===q.gymTown);
            return target && q.inProgress() && !q.isCompleted() ? [{...target,key:`quest:${this.questIds.get(q)}`,quest:q}] : [];
        });
        return [];
    }
    static affordable(currency,cost) {
        const prefix = currency === 'money' ? 'money' : 'token';
        return ['money','dungeonToken'].includes(currency) && Number.isFinite(cost) && cost >= 0
            && this.spent[currency]+cost <= this.settings[`${prefix}Budget`]
            && App.game.wallet.currencies[GameConstants.Currency[currency]]()-cost >= this.settings[`${prefix}Reserve`];
    }
    static spend(currency,cost,action) {
        if (!this.affordable(currency,cost)) return false;
        // Reserve the quote before the synchronous native action, so recursive callbacks cannot overspend.
        this.spent[currency] += cost;
        const result = action();
        if (result === false) { this.spent[currency] -= cost; return false; }
        return true;
    }
    static canPay(t) {
        return t.kind !== 'dungeon' || (DungeonRunner.canStartDungeon(TownList[t.name].dungeon) && this.affordable('dungeonToken',TownList[t.name].dungeon.tokenCost));
    }
    static tick(force = false) {
        if (!this.active) return;
        try {
            if (Date.now() >= this.deadline) { this.stop('Session time limit'); return; }
            const state = App.game.gameState, gs = GameConstants.GameState;
            if (![gs.town,gs.fighting,gs.dungeon,gs.gym].includes(state)) { this.stop('Other activity started',false); return; }
            if (DungeonGuides.hired()) { this.stop('Dungeon Guides started',false); return; }
            if (state === gs.dungeon || state === gs.gym) {
                if ((state === gs.dungeon && (this.current?.kind !== 'dungeon' || DungeonRunner.dungeon?.name !== this.current.name)) ||
                    (state === gs.gym && (this.current?.kind !== 'gym' || GymRunner.gymObservable?.()?.town !== this.current.gym))) {
                    this.stop('External battle started',false); return;
                }
                // Never move to the next objective while its battle is still running.
                if (Date.now()-this.lastProgressAt >= this.settings.stallMinutes*60000) this.stop('Battle stalled');
                return;
            }
            if (Battle.catching() || DungeonBattle.catching()) return;
            if (this.current && this.settings.mode !== 'shop') {
                const t = this.current, loc = this.location();
                if ((t.kind === 'route' && (loc.kind !== 'route' || loc.number !== t.number || loc.region !== t.region)) ||
                    (t.kind !== 'route' && (loc.kind !== 'town' || loc.name !== t.name))) {
                    this.stop('Location changed outside the controller',false,true); return;
                }
            }
            if (!force && Date.now() < this.nextPlanAt) return;
            this.nextPlanAt = Date.now()+500;
            if (this.current) {
                const t = this.current;
                const p = this.progress(t);
                if (p !== this.lastProgress) {this.lastProgress=p;this.lastProgressAt=Date.now();}
                if (Date.now()-this.lastProgressAt >= this.settings.stallMinutes*60000 && this.settings.mode !== 'frontier') {
                    this.skipped.add(t.key); this.current=null;
                } else if (!this.accessible(t) || !this.remaining(t) || !this.canPay(t)) this.current=null;
            }
            if (!this.current) {
                const next = this.candidates().find(t=>!this.skipped.has(t.key) && this.accessible(t) && this.remaining(t) && this.canPay(t));
                if (!next) { this.stop('No eligible objective remains (completed, unavailable, budget or skipped)'); return; }
                this.current=next;this.lastProgress=this.progress(next);this.lastProgressAt=Date.now();
                if (!this.move(next)) {this.skipped.add(next.key);this.current=null;return;}
                this.status(`ON · ${next.name || `Route ${next.number} / region ${next.region}`} · Stop & return or travel manually to cancel`);
            }
            const t=this.current;
            if (this.settings.mode === 'purify') {
                const chamber = App.game.purifyChamber;
                if (!PurifyChamber.requirements.isCompleted()) { this.stop('Purify Chamber locked'); return; }
                if (chamber.currentFlow() < chamber.flowNeeded()) return;
                const previous = chamber.selectedPokemon();
                const selected = previous?.shadow === GameConstants.ShadowStatus.Shadow ? previous
                    : App.game.party.caughtPokemon.find(p=>p.shadow === GameConstants.ShadowStatus.Shadow);
                try {
                    chamber.selectedPokemon(selected);
                    if (chamber.canPurify()) {
                        chamber.purify();
                        if (selected.shadow === GameConstants.ShadowStatus.Purified) this.purified++;
                    }
                } finally { chamber.selectedPokemon(previous); }
            } else if (t.kind === 'dungeon') {
                const d=TownList[t.name].dungeon;
                if (!this.spend('dungeonToken',d.tokenCost,()=>this.own(()=>DungeonRunner.initializeDungeon(d)))) {
                    this.skipped.add(t.key); this.current = null; return;
                }
                this.runId = DungeonRunner.dungeonID;
                this.clicker.autoDungeonTracker.ID=-1;
            } else if (t.kind === 'gym') this.own(()=>GymRunner.startGym(GymList[t.gym],false));
            else if (t.kind === 'shop') {
                const item=this.shopItem();
                if (item.totalPrice(1) > Math.round(item.basePrice)) {
                    if (this.location().kind !== this.origin.kind || player.route !== (this.origin.number || 0) || (!player.route && player.town.name !== this.origin.name)) this.move(this.origin);
                    this.status('ON · Waiting for the base shop price. Start from a route to recover prices by battling.');
                    return;
                }
                if (!this.move(t)) { this.stop('Shop no longer accessible'); return; }
                const currency=item.currency===GameConstants.Currency.money?'money':item.currency===GameConstants.Currency.dungeonToken?'dungeonToken':null;
                if (!currency || !item.isAvailable() || item.isSoldOut() || !this.spend(currency,item.totalPrice(1),()=>item.buy(1))) {
                    this.stop('Stock purchase stopped: budget, reserve or availability');
                }
            }
        } catch (e) { console.error('[Auto Navigation]',e);this.stop(`Stopped after error: ${e.message}`); }
    }
    static explore() {
        if (!this.active || this.current?.kind !== 'dungeon') return;
        try { this.own(()=>this.clicker.autoDungeon()); }
        catch (e) { console.error('[Auto Navigation]',e);this.stop('Dungeon traversal failed'); }
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

if (!App.isUsingClient || localStorage.getItem('autonavigation') === 'true') {
    loadEpheniaScript('autonavigation', () => AutoNavigator.init());
}
