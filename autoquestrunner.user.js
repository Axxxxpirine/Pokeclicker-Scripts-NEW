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
    // Rates are useful native progress units per second, measured by the runtime.
    // Missing rates remain unknown rather than fabricating completion estimates.
    static questMetrics = Object.freeze({
        DefeatPokemonsQuest:'defeat', CapturePokemonsQuest:'capture', CapturePokemonTypesQuest:'captureType',
        ClearBattleFrontierQuest:'frontier', GainFarmPointsQuest:'farmPoints', GainMoneyQuest:'money',
        GainTokensQuest:'tokens', GainGemsQuest:'gems', HatchEggsQuest:'hatch', MineLayersQuest:'layers',
        MineItemsQuest:'items', CatchShiniesQuest:'shiny', CatchShadowsQuest:'shadow', DefeatGymQuest:'gym',
        DefeatDungeonQuest:'dungeon', UsePokeballQuest:'ball', UseOakItemQuest:'oak', HarvestBerriesQuest:'berries',
    });
    static read(value) { return typeof value === 'function' ? value() : value; }
    static readQuestSnapshot(context = {}) {
        const game = App.game, list = this.read(game.quests?.questList) || [];
        if (!this.questObjects || list.length !== this.questObjects.length || list.some((q,i) => q !== this.questObjects[i])) {
            this.questEpoch = (this.questEpoch || 0) + 1;
            this.questObjects = [...list];
        }
        const quests = list.map((q,index) => {
            const type = q.constructor.name, amount = Math.max(0, Number(q.amount) || 0);
            const initial = this.read(q.initial), focus = Number(this.read(q.focus));
            const progress = initial == null ? 0 : Math.max(0, Math.min(amount, focus - Number(initial)));
            const target = type === 'DefeatPokemonsQuest' ? {kind:'route',number:q.route,region:q.region}
                : type === 'DefeatGymQuest' ? {kind:'gym',gym:q.gymTown}
                : type === 'DefeatDungeonQuest' ? {kind:'dungeon',name:q.dungeon}
                : {type:q.type,berryType:q.berryType,pokeball:q.pokeball,item:q.item};
            const known = Object.hasOwn(this.questMetrics,type);
            return {id:`${this.questEpoch}:${index}`,native:q,type,amount,remaining:Number.isFinite(progress) ? amount-progress : amount,
                reward:Math.max(0,Number(q.pointsReward)||0),target,known,claimed:!!this.read(q.claimed),active:initial != null,
                reason:known ? null : `Unknown quest class: ${type}`};
        });
        const value = v => Number(this.read(v)) || 0;
        const currencies = game.wallet?.currencies || [];
        const resources = {money:value(currencies[0]),dungeonToken:value(currencies[1]),
            balls:(game.pokeballs?.pokeballs || []).map(b => value(b.quantity))};
        const activities = this.readActivities(context);
        return {epoch:this.questEpoch,quests,resources,activities,rates:context.rates || {},
            power:{attack:value(game.party?.pokemonAttackObservable),click:value(game.party?.calculateClickAttack?.bind(game.party))},
            commitments:context.commitments || {},previous:context.previous || null};
    }
    static readActivities(context) {
        if (context.activities) return context.activities;
        const activities = [];
        if (typeof Routes !== 'undefined') for (const route of Routes.regionRoutes) {
            const names = typeof RouteHelper === 'undefined' ? [] : RouteHelper.getAvailablePokemonList(route.number,route.region);
            const encounters = names.map(n => typeof pokemonMap === 'undefined' ? null : pokemonMap[n]).filter(Boolean);
            const id = `route:${route.region}:${route.number}`;
            const target = {kind:'route',number:route.number,region:route.region};
            const reason = this.departureRestriction(target) || (!route.isUnlocked() ? 'Route locked' : null)
                || (typeof MapHelper !== 'undefined' && !MapHelper.accessToRoute(route.number,route.region) ? 'Route inaccessible' : null);
            activities.push({id,target,unlocked:!reason,reason,
                encounters,types:[...new Set(encounters.flatMap(p => p.type))],
                capabilities:['defeat','capture','captureType','money','tokens','gems','shiny'],rates:context.rates?.[id] || {}});
        }
        if (typeof GymList !== 'undefined') for (const [key,gym] of Object.entries(GymList)) {
            if (!gym.parent) continue;
            const target = {kind:'gym',name:gym.parent.name,gym:key,region:gym.parent.region};
            const reason = this.destinationRestriction(target,gym);
            const id = `gym:${key}`;
            activities.push({id,target,unlocked:!reason,reason,capabilities:['gym'],rates:context.rates?.[id] || {}});
        }
        if (typeof TownList !== 'undefined') for (const [name,town] of Object.entries(TownList)) {
            const dungeon = town.dungeon;
            if (!dungeon) continue;
            const target = {kind:'dungeon',name,region:town.region};
            const restriction = this.destinationRestriction(target,dungeon);
            const waitingGuide = restriction === 'Wait for hired dungeon guide';
            const reason = waitingGuide ? null : restriction;
            const id = `dungeon:${name}`;
            activities.push({id,target,unlocked:!reason,reason,capabilities:['dungeon'],rates:context.rates?.[id] || {},
                requirements:[{resource:'dungeonToken',amount:Number(dungeon.tokenCost)},
                    ...(waitingGuide ? [{resource:'guide',amount:1,reason:restriction}] : [])]});
        }
        // Adapter inspection supplies availability and existing commitments without applying objectives.
        for (const name of ['farm','hatchery','mine','frontier']) {
            const inspection = this.registry().adapters[name]?.inspect();
            for (const activity of inspection?.activities || []) activities.push({...activity,module:name});
            const native = {farm:App.game.farming,hatchery:App.game.breeding,mine:App.game.underground}[name];
            if (!inspection?.activities?.length && native?.canAccess?.()) {
                const capabilities = {farm:['farmPoints'],hatchery:['hatch','capture','shiny'],mine:['layers','items']}[name];
                activities.push({id:name,target:{kind:name},module:name,unlocked:true,capabilities,rates:context.rates?.[name] || {}});
            }
        }
        return activities;
    }
    static departureRestriction(target) {
        if (typeof player !== 'undefined') {
            if (target.region < 0 || target.region > player.highestRegion()) return 'Destination region locked';
            if (target.region !== player.region && !(player.highestRegion() > 0 &&
                TownList[GameConstants.DockTowns?.[player.region]]?.isUnlocked())) return 'Departure dock locked';
        }
        return null;
    }
    static destinationRestriction(target,native) {
        const town = typeof TownList !== 'undefined' && TownList[target.name];
        if (!town?.isUnlocked()) return 'Destination town locked';
        const departure = this.departureRestriction(target);
        if (departure) return departure;
        if (typeof MapHelper !== 'undefined' && !MapHelper.accessToTown(target.name)) return 'Destination town inaccessible';
        if (!native.isUnlocked()) return 'Native destination locked (ticket or requirements)';
        if (target.kind === 'dungeon') {
            if (!native.hasUnlockedBoss()) return 'No unlocked dungeon boss';
            if (typeof DungeonGuides !== 'undefined' && DungeonGuides.hired()) return 'Wait for hired dungeon guide';
        }
        return null;
    }
    static activityMatches(quest, activity) {
        const metric = this.questMetrics[quest.type], target = quest.target;
        if (target.gym && target.gym !== activity.target.gym) return false;
        if (target.kind && (activity.target.kind !== target.kind || (target.name && target.name !== activity.target.name)
            || (target.number != null && (target.number !== activity.target.number || target.region !== activity.target.region)))) return false;
        if (['captureType','gems'].includes(metric) && !activity.types?.includes(target.type)) return false;
        if (metric === 'berries' && activity.berryType !== target.berryType) return false;
        if (metric === 'ball' && (target.pokeball > 2 || activity.pokeball !== target.pokeball)) return false;
        if (metric === 'oak' && !activity.oakItems?.includes(target.item)) return false;
        return true;
    }
    static activityRate(quest, activity) {
        if (!this.activityMatches(quest,activity)) return 0;
        const metric = this.questMetrics[quest.type];
        const rate = Number(activity.rates?.[`${metric}:${JSON.stringify(quest.target)}`] ?? activity.rates?.[metric]);
        return Number.isFinite(rate) && rate > 0 ? rate : 0;
    }
    static buildCandidates(snapshot) {
        return snapshot.activities.filter(a => a.unlocked === true).map(activity => {
            const contributions = snapshot.quests.filter(q => q.known && !q.claimed && q.remaining > 0)
                .map(q => ({quest:q,rate:this.activityRate(q,activity)})).filter(c => c.rate > 0 ||
                    (this.activityMatches(c.quest,activity) && activity.capabilities?.includes(this.questMetrics[c.quest.type])));
            if (!contributions.length) return null;
            const shortfall = requirements => requirements.filter(r => !Number.isFinite(r.amount) || (snapshot.resources[r.resource] || 0) < r.amount)
                .map(r => ({...r,missing:r.amount-(snapshot.resources[r.resource] || 0)}));
            const entryPrerequisites = shortfall(activity.requirements || []);
            const totalRequirements = (activity.requirements || []).map(requirement => ({...requirement,
                amount:activity.target.kind === 'dungeon' && requirement.resource === 'dungeonToken'
                    ? requirement.amount * Math.max(...contributions.filter(c => c.quest.type === 'DefeatDungeonQuest').map(c => c.quest.remaining),1)
                    : requirement.amount}));
            const prerequisites = shortfall(totalRequirements);
            if (activity.module && snapshot.commitments[activity.module] && snapshot.commitments[activity.module] !== activity.id)
                prerequisites.push({resource:'commitment',module:activity.module,reason:'Wait for existing work'});
            let recoverySeconds = 0, estimated = contributions.every(c => c.rate > 0);
            for (const requirement of prerequisites) {
                const recoveryRate = snapshot.rates[requirement.resource];
                if (!(recoveryRate > 0) || !Number.isFinite(recoveryRate) || requirement.resource === 'commitment') estimated = false;
                else recoverySeconds += requirement.missing / recoveryRate;
            }
            const seconds = Math.max(...contributions.map(c => c.quest.remaining/c.rate)) + Math.max(0,activity.setupSeconds || 0) + recoverySeconds;
            const reward = contributions.reduce((sum,c) => sum+c.quest.reward,0);
            return {...activity,questIds:contributions.map(c => c.quest.id),contributions:contributions.map(c => ({id:c.quest.id,rate:c.rate})),
                prerequisites,entryPrerequisites,totalRequirements,exploratory:!estimated &&
                    (!prerequisites.length || (activity.target.kind === 'dungeon' && !entryPrerequisites.length)),seconds:estimated && Number.isFinite(seconds) ? seconds : null,
                score:estimated && seconds > 0 && Number.isFinite(seconds) ? reward/seconds : 0,
                reason:estimated ? null : prerequisites.length ? 'Resource recovery estimate unavailable' : 'Progress estimate unavailable, observe useful attempts'};
        }).filter(Boolean);
    }
    static selectPlan(snapshot, candidates) {
        const reasons = snapshot.quests.filter(q => !q.known).map(q => q.reason);
        for (const activity of snapshot.activities.filter(a => !a.unlocked && a.reason)) reasons.push(`${activity.id}: ${activity.reason}`);
        for (const q of snapshot.quests.filter(q => q.known && !q.claimed && q.remaining > 0)) {
            if (!candidates.some(c => c.questIds.includes(q.id))) reasons.push(`${q.id}: No unlocked path with a useful progress estimate`);
        }
        const ranked = candidates.filter(c => c.seconds !== null && c.score > 0).sort((a,b) => b.score-a.score || a.id.localeCompare(b.id));
        const exploratory = candidates.filter(c => c.exploratory).sort((a,b) => a.id.localeCompare(b.id));
        const available = [...ranked,...exploratory];
        const background = [], modules = new Set();
        for (const candidate of available.filter(c => ['farm','hatchery','mine'].includes(c.module))) {
            if (!modules.has(candidate.module)) { modules.add(candidate.module); background.push(candidate); }
        }
        let primary = available.find(c => !modules.has(c.module)) || null;
        const previous = ranked.find(c => c.id === snapshot.previous?.id);
        const completion = snapshot.quests.some(q => !q.claimed && q.remaining === 0);
        if (!completion && previous && primary && !modules.has(previous.module) && previous.score >= primary.score * .85) primary = previous;
        for (const c of candidates.filter(c => c.reason)) reasons.push(`${c.id}: ${c.reason}`);
        return {epoch:snapshot.epoch,primary,background,reasons,claimable:snapshot.quests.filter(q => !q.claimed && q.remaining === 0).map(q => q.id),
            replan:completion || snapshot.previous?.epoch !== snapshot.epoch};
    }
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
        this.confirmedClaims = new WeakSet(); this.executing = null; this.currentPlan = null;
        this.observation = null; this.observedRates = {}; this.rateSamples = {};
        if (App.game.quests?.questList) {
            const quests = registry.adapters.quests;
            if (quests && !this.acquired.some(e => e.name === 'quests')) {
                if (!quests.acquire(owner)) { this.stop('Quests controlled by another session'); return false; }
                this.acquired.push({name:'quests',adapter:quests});
            }
            this.timer = setInterval(() => this.tick(owner),250);
            this.tick(owner);
        }
        this.render(); return this.active;
    }
    // Runtime extension points: planningContext, executePlan and observeProgress are
    // deliberately separate so supply/background adapters can join the same session.
    static planningContext() { return {rates:this.observedRates || {},previous:this.currentPlan?.primary}; }
    static resolveQuest(entry, epoch) {
        const snapshot = this.readQuestSnapshot(this.planningContext());
        if (snapshot.epoch !== epoch) return null;
        return snapshot.quests.find(q => q.native === entry.native) || null;
    }
    static observeProgress(snapshot) {
        const now = Date.now(), previous = this.observation;
        if (!previous || previous.epoch !== snapshot.epoch) {
            this.observedRates = {}; this.rateSamples = {}; this.currentPlan = null; this.observation = {epoch:snapshot.epoch,time:now,quests:snapshot.quests,activity:null}; return;
        }
        const seconds = (now-previous.time)/1000;
        if (seconds <= 0 || !this.currentPlan?.primary) return;
        const activity = this.currentPlan.primary, rates = this.observedRates[activity.id] ||= {};
        for (const q of snapshot.quests) {
            const before = previous.quests.find(p => p.native === q.native);
            if (previous.activity !== activity.id || !before?.active || !q.active || !this.activityMatches(q,activity)) continue;
            const delta = before.remaining-q.remaining;
            // Include time with zero useful progress, rather than measuring only
            // lucky successes. Separate targets sharing a metric never borrow rates.
            const key = `${this.questMetrics[q.type]}:${JSON.stringify(q.target)}`;
            const samples = this.rateSamples[activity.id] ||= {};
            const sample = samples[key] ||= {units:0,seconds:0};
            sample.units += Math.max(0,delta); sample.seconds += seconds;
            if (sample.units > 0) rates[key] = sample.units/sample.seconds;
        }
        this.observation = {epoch:snapshot.epoch,time:now,quests:snapshot.quests,activity:activity.id};
    }
    static executePlan(snapshot, plan) {
        const primary = plan.primary;
        if (!primary || !['route','gym','dungeon'].includes(primary.target.kind)) {
            this.reason = plan.reasons.join(' · ') || 'Waiting for a supported quest activity'; return;
        }
        const nav = this.acquired.find(e => e.name === 'navigation')?.adapter;
        const inspection = nav?.inspect();
        if (inspection?.status === 'blocked') { this.reason = inspection.reason || 'Navigation blocked'; return; }
        if (this.executing?.epoch === snapshot.epoch && this.executing.id === primary.id &&
            !['done','ready'].includes(inspection?.status)) return;
        // One native victory/clear is a safe replanning boundary even when the
        // quest measures money, captures or another non-location counter.
        if (this.apply('navigation',{target:primary.target,count:1,session:{moneyBudget:Number.MAX_SAFE_INTEGER,
            tokenBudget:Number.MAX_SAFE_INTEGER,minutes:1440,stallMinutes:1440}})) {
            this.executing = {id:primary.id,epoch:snapshot.epoch}; this.reason = primary.reason || 'Working';
        } else this.reason = 'Navigation objective unavailable';
    }
    static tick(owner = this.owner) {
        if (!owner?.isCurrent() || this.ticking) return;
        this.ticking = true;
        try {
            let snapshot = this.readQuestSnapshot(this.planningContext());
            this.observeProgress(snapshot);
            // Native final claim may synchronously replace the list. Perform one
            // claim per pass and rediscover before any subsequent native action.
            for (const entry of snapshot.quests.filter(q => q.active && !q.claimed && !q.remaining)) {
                const current = this.resolveQuest(entry,snapshot.epoch);
                if (!owner.isCurrent() || !current || this.confirmedClaims.has(current.native)) continue;
                App.game.quests.claimQuest(this.questObjects.indexOf(current.native));
                const after = this.readQuestSnapshot(this.planningContext());
                if (this.read(current.native.claimed) || !after.quests.some(q => q.native === current.native)) {
                    this.confirmedClaims.add(current.native);
                }
                // A deferred native completion computed may have refused this
                // attempt. Leave it eligible on a later reconciliation pass.
                // The ticking guard prevents reentrant attempts in this pass.
                return;
            }
            const slots = this.registry().adapters.quests?.inspect().slots ?? (Number(this.read(App.game.quests.questSlots)) || 1);
            for (const entry of snapshot.quests.filter(q => q.known && !q.active && !q.claimed)) {
                const current = this.resolveQuest(entry,snapshot.epoch);
                if (!owner.isCurrent() || !current) return;
                const fresh = this.readQuestSnapshot(this.planningContext());
                if (fresh.quests.filter(q => q.active && !q.claimed).length >= slots || !App.game.quests.canStartNewQuest()) break;
                App.game.quests.beginQuest(this.questObjects.indexOf(current.native));
            }
            snapshot = this.readQuestSnapshot(this.planningContext());
            // Pending slot entries cannot steal execution from accepted quests.
            const activeSnapshot = {...snapshot,quests:snapshot.quests.filter(q => q.active)};
            const plan = this.selectPlan(activeSnapshot,this.buildCandidates(activeSnapshot));
            this.executePlan(snapshot,plan); this.currentPlan = plan;
            if (this.observation) {
                this.observation.activity = plan.primary?.id;
                this.observation.quests = snapshot.quests;
            }
            this.render();
        } catch (error) { this.stop(`Quest execution failed: ${error.message}`); }
        finally { this.ticking = false; }
    }
    static apply(name, objective) {
        if (!this.owner?.isCurrent()) return false;
        return this.acquired.find(entry => entry.name === name)?.adapter.apply(this.owner, objective) ?? false;
    }
    static stop(reason = 'Stopped') {
        if (!this.active) return;
        this.owner.active = false; this.active = false;
        clearInterval(this.timer); this.timer = null;
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
