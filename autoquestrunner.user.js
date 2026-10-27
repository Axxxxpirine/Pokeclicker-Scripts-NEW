// ==UserScript==
// @name          [Pokeclicker] Auto Quest Runner
// @namespace     Pokeclicker Scripts
// @author        Joey / Codex (automation adapter integration)
// @description   Complete repeatable quests, prepare supplies and coordinate parallel automation with one session-only switch.
// @license       GPL-3.0 License
// @version       1.1.2
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
            const shadowEncounters = this.shadowEncounters(dungeon);
            activities.push({id,target,unlocked:!reason,reason,shadowEncounters,capabilities:['dungeon',...(shadowEncounters.length ? ['shadow'] : [])],rates:context.rates?.[id] || {},
                requirements:[{resource:'dungeonToken',amount:Number(dungeon.tokenCost)},
                    ...(waitingGuide ? [{resource:'guide',amount:1,reason:restriction}] : [])]});
        }
        // Adapter inspection supplies availability and existing commitments without applying objectives.
        for (const name of ['farm','hatchery','mine','frontier']) {
            const inspection = this.registry().adapters[name]?.inspect();
            for (const activity of inspection?.activities || []) {
                const restriction=activity.target.kind==='frontier' ? this.departureRestriction(activity.target) : null;
                activities.push({...activity,module:name,...(restriction ? {unlocked:false,reason:restriction} : {})});
            }
            const native = {farm:App.game.farming,hatchery:App.game.breeding,mine:App.game.underground}[name];
            if (!inspection?.activities?.length && native?.canAccess?.()) {
                const capabilities = {farm:['farmPoints'],hatchery:['hatch','capture','shiny'],mine:['layers','items']}[name];
                activities.push({id:name,target:{kind:name},module:name,unlocked:true,capabilities,rates:context.rates?.[name] || {}});
            }
        }
        return activities;
    }
    static shadowEncounters(dungeon) {
        // Display rows lose boss trainer locks. Inspect executable definitions.
        return [...new Set([...(dungeon.enemyList || []),...(dungeon.bossList || [])].flatMap(enemy => {
            if (!enemy || typeof enemy.getTeam !== 'function' || enemy.options?.requirement && !enemy.options.requirement.isCompleted()) return [];
            return enemy.getTeam().filter(p => p.shadow === GameConstants.ShadowStatus.Shadow).map(p => p.name);
        }))];
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
        return snapshot.activities.filter(a => a.unlocked === true).map(a => this.prepareActivity(a,snapshot)).map(activity => {
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
            const sources = contributions.map(c => {
                if (!(c.rate > 0)) return 'unknown';
                const metric = this.questMetrics[c.quest.type];
                const key = `${metric}:${JSON.stringify(c.quest.target)}`;
                return activity.rateSources?.[key] || activity.rateSources?.[metric] || activity.estimateSource || (c.rate > 0 ? 'observed' : 'unknown');
            });
            const estimateSource = [...new Set(sources)].join(' + ');
            return {...activity,estimateSource,questIds:contributions.map(c => c.quest.id),contributions:contributions.map(c => ({id:c.quest.id,rate:c.rate})),
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
            if (!candidates.some(c => c.questIds.includes(q.id))) reasons.push(`${q.id}: ${q.type==='CatchShadowsQuest' ? 'No unlocked native Shadow trainer encounter' : 'No unlocked path with a useful progress estimate'}`);
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
    // Conservative bootstrap estimates use native mechanics, never reward/stat writes.
    // Observations keyed to a quest target replace these priors as soon as useful data exists.
    static nativeRates(activity, ball = activity.pokeball ?? 0) {
        if (activity.target.kind !== 'route' || typeof PokemonFactory === 'undefined') return {};
        const {number,region} = activity.target, party = App.game.party;
        const encounters = activity.encounters || [];
        const attacks = encounters.map(p => Number(party?.calculatePokemonAttack?.(p.type1 ?? p.type?.[0],p.type2 ?? p.type?.[1])) || 0);
        const power = attacks.length ? Math.min(...attacks) : Number(this.read(party?.pokemonAttackObservable));
        const click = Number(party?.calculateClickAttack?.()) || 0;
        const health = Number(PokemonFactory.routeHealth?.(number,region));
        if (!(power+click > 0 && health > 0)) return {};
        // One party hit and at most one click/sec is deliberately conservative.
        const defeatSeconds = Math.max(1,Math.ceil(health*1.2 / (power+click)));
        const bonus = Number(App.game.pokeballs?.getCatchBonus?.(ball)) || 0;
        const oak = typeof OakItemType === 'undefined' ? 0 : Number(App.game.oakItems?.calculateBonus?.(OakItemType.Magic_Ball)) || 0;
        const chances = encounters.map(p => {
            const base = typeof PokemonHelper === 'undefined' ? p : PokemonHelper.getPokemonByName?.(p.name) || p;
            const rate = Number(PokemonFactory.catchRateHelper?.(base.catchRate,true));
            return Number.isFinite(rate) ? Math.max(0,Math.min(100,rate-3+bonus+oak))/100 : 0;
        });
        const probability = chances.length ? chances.reduce((a,b)=>a+b,0)/chances.length : 0;
        const catchSeconds = Math.max(0,Number(App.game.pokeballs?.calculateCatchTime?.(ball)) || 0)/1000;
        const attempts = 1/(defeatSeconds+catchSeconds);
        const money = Number(PokemonFactory.routeMoney?.(number,region,false));
        const tokens = Number(PokemonFactory.routeDungeonTokens?.(number,region));
        return {defeat:1/defeatSeconds,money:money>0 ? money/defeatSeconds : 0,
            capture:attempts*probability,ball:attempts,tokens:tokens>0 ? attempts*probability*tokens : 0,
            captureProbability:probability,defeatSeconds,catchSeconds};
    }
    static chooseBall(snapshot, activity) {
        const owned=[0,1,2].filter(b=>(snapshot.resources.balls?.[b] || 0)>0);
        const choices=(owned.length ? owned : [0,1,2]).map(ball=>{
            const native=this.nativeRates(activity,ball);
            const quotes=owned.length ? [0] : this.shopsForBall(ball).map(s=>Number(s.item.totalPrice(1))).filter(p=>Number.isFinite(p) && p>=0);
            const price=quotes.length ? Math.min(...quotes) : Infinity;
            const moneyRate=native.money || 0;
            const seconds=native.captureProbability>0 ? ((native.defeatSeconds+native.catchSeconds) + (price ? moneyRate>0 ? price/moneyRate : Infinity : 0))/native.captureProbability : Infinity;
            return {ball,seconds,price};
        }).sort((a,b)=>a.seconds-b.seconds || a.price-b.price || a.ball-b.ball);
        return choices[0]?.ball ?? 0;
    }
    static policyMatches(quest, activity) {
        if (['UsePokeballQuest','UseOakItemQuest'].includes(quest.type)) return activity.target.kind==='route';
        return this.activityMatches(quest,activity);
    }
    static prepareActivity(activity, snapshot) {
        if (activity.target.kind !== 'route') return activity;
        const matching = snapshot.quests.filter(q => !q.claimed && q.remaining>0 && this.policyMatches(q,activity));
        const required = matching.find(q => q.type === 'UsePokeballQuest' && q.target.pokeball >= 0 && q.target.pokeball <= 2);
        const ball = required?.target.pokeball ?? activity.pokeball ?? this.chooseBall(snapshot,activity);
        const oak = App.game.oakItems;
        const oakItems = activity.oakItems || matching.filter(q => q.type === 'UseOakItemQuest' && oak?.isUnlocked(q.target.item))
            .map(q => q.target.item).filter((id,i,a)=>a.indexOf(id)===i).slice(0,oak?.maxActiveCount?.() || 0);
        const priors = this.nativeRates(activity,ball);
        const rates = {...priors,...activity.rates};
        for (const q of matching) {
            const fraction = (activity.encounters || []).filter(p => p.type?.includes(q.target.type) || p.type1===q.target.type || p.type2===q.target.type).length / (activity.encounters?.length || 1);
            const key = `${this.questMetrics[q.type]}:${JSON.stringify(q.target)}`;
            if (Object.hasOwn(activity.rates || {},key)) continue;
            if (q.type === 'CapturePokemonTypesQuest' && priors.capture > 0) rates[key] = priors.capture*fraction;
            if (q.type === 'GainGemsQuest' && priors.defeat > 0 && App.game.gems?.canAccess?.()) rates[key] = priors.defeat*fraction;
            if (q.type === 'UseOakItemQuest' && oakItems.includes(q.target.item) && typeof OakItemType !== 'undefined')
                rates[key] = q.target.item === OakItemType.Magic_Ball ? priors.capture : priors.defeat;
        }
        const rateSources = Object.fromEntries(Object.keys(rates).map(key => [key,
            Object.hasOwn(activity.rates || {},key) ? 'observed' : 'native prior']));
        return {...activity,pokeball:ball,oakItems,rates,rateSources,estimateSource:Object.keys(activity.rates || {}).length ? 'observed' : Object.keys(priors).length ? 'native prior' : 'unknown',
            capabilities:[...(activity.capabilities || []),'ball',...(oakItems.length ? ['oak'] : [])]};
    }
    static acceptanceOrder(snapshot) {
        const candidates = this.buildCandidates(snapshot);
        const priority = q => Math.max(0,...candidates.filter(c => c.questIds.includes(q.id) && (!c.entryPrerequisites.length || c.entryPrerequisites.every(p=>['money','dungeonToken'].includes(p.resource))))
            .map(c => c.score>0 ? c.score : c.exploratory ? 0.000001 : 0));
        return snapshot.quests.filter(q=>q.known && !q.active && !q.claimed)
            .map((q,index)=>({q,index,priority:priority(q)})).sort((a,b)=>b.priority-a.priority || a.index-b.index).map(e=>e.q);
    }
    static shopsForBall(ball) {
        if (ball<0 || ball>2 || typeof TownList === 'undefined') return [];
        const result=[];
        for (const town of Object.values(TownList)) {
            const target={kind:'town',name:town.name,region:town.region};
            if (!town.isUnlocked?.() || this.departureRestriction(target) || (typeof MapHelper !== 'undefined' && !MapHelper.accessToTown(town.name))) continue;
            for (const shop of town.content || []) {
                if (shop.parent !== town || !shop.items || !shop.isUnlocked?.()) continue;
                for (const item of shop.items) if (item.type===ball && item.name===['Pokeball','Greatball','Ultraball'][ball]
                    && item.currency===0 && item.isAvailable() && !item.isSoldOut()) result.push({shop,item,target});
            }
        }
        return result;
    }
    static recoveryActivity(snapshot, resource) {
        const metric=resource==='dungeonToken' ? 'tokens' : 'money';
        return snapshot.activities.filter(a=>a.unlocked && a.target.kind==='route').map(a=>this.prepareActivity(a,snapshot))
            .filter(a=>a.rates[metric]>0).sort((a,b)=>b.rates[metric]-a.rates[metric] || a.id.localeCompare(b.id))[0];
    }
    static planSupplies(snapshot, objective) {
        if (!objective) return {ready:false,reason:'No supply objective'};
        const quests=snapshot.quests.filter(q=>q.active !== false && !q.claimed && q.remaining>0 &&
            this.policyMatches(q,objective));
        const exact=quests.find(q=>q.type==='UsePokeballQuest');
        if (exact && !(exact.target.pokeball>=0 && exact.target.pokeball<=2)) return {ready:false,reason:'Only standard balls are used automatically'};
        const magic=typeof OakItemType === 'undefined' ? 0 : OakItemType.Magic_Ball;
        const captureQuests=quests.filter(q=>['CapturePokemonsQuest','CapturePokemonTypesQuest','GainTokensQuest','CatchShiniesQuest','CatchShadowsQuest','UsePokeballQuest'].includes(q.type)
            || q.type==='UseOakItemQuest' && q.target.item===magic);
        const needsCapture=captureQuests.length>0 || objective.recoverTokens;
        const oakItems=objective.oakItems || [];
        if (!needsCapture) return {ready:true,capture:{ball:-1},oakItems};
        const ball=exact?.target.pokeball ?? objective.pokeball ?? this.chooseBall(snapshot,objective);
        if (!(ball>=0 && ball<=2)) return {ready:false,reason:'Only standard balls are used automatically'};
        const type=quests.find(q=>q.type==='CapturePokemonTypesQuest')?.target.type;
        const capture={ball,type:quests.some(q=>q.type!=='CapturePokemonTypesQuest') || objective.recoverTokens ? undefined : type};
        // Work with existing stock first. Refill only after this short work batch is exhausted.
        if ((snapshot.resources.balls?.[ball] || 0)>0) return {ready:true,ball,capture,oakItems};
        const native=this.nativeRates(objective,ball);
        const probability=native.captureProbability || (objective.rates?.ball>0 ? objective.rates.capture/objective.rates.ball : 0);
        if (!exact && !captureQuests.some(q=>['CatchShiniesQuest','CatchShadowsQuest'].includes(q.type)) && !(probability>0)) return {ready:false,ball,reason:'Native capture probability estimate unavailable'};
        const tokenYield=typeof PokemonFactory==='undefined' ? 0 : Number(PokemonFactory.routeDungeonTokens?.(objective.target.number,objective.target.region));
        if (quests.some(q=>q.type==='GainTokensQuest') && !(tokenYield>0)) return {ready:false,ball,reason:'Native token yield estimate unavailable'};
        const attempts=Math.max(1,...captureQuests.map(q=>q.type==='UsePokeballQuest' ? q.remaining
            : q.type==='GainTokensQuest' ? q.remaining/(probability*tokenYield) : q.remaining/(probability || 1)));
        const quantity=Math.min(100,Math.ceil(attempts));
        const reserve=Math.max(0,...(objective.requirements || []).filter(p=>p.resource==='money').map(p=>Number(p.amount)||0));
        const shops=this.shopsForBall(ball).map(s=>({...s,quote:Number(s.item.totalPrice(quantity))})).filter(s=>Number.isFinite(s.quote) && s.quote>=0).sort((a,b)=>a.quote-b.quote);
        if (!shops.length) return {ready:false,ball,reason:'No unlocked native shop sells the required standard ball'};
        let purchase={...shops[0],ball,quantity,stock:snapshot.resources.balls?.[ball] || 0,reserve};
        // If the batch is unaffordable, buy a useful affordable portion instead of banking for 100.
        while (purchase.quantity>1 && purchase.quote+reserve>snapshot.resources.money) {
            purchase.quantity--; purchase.quote=Number(purchase.item.totalPrice(purchase.quantity));
        }
        if (!(Number.isFinite(purchase.quote) && purchase.quote>=0)) return {ready:false,reason:'Native price unavailable'};
        if (purchase.quote+reserve>snapshot.resources.money) {
            const activity=this.recoveryActivity(snapshot,'money');
            return {ready:false,ball,capture,oakItems,reason:activity ? 'Earning money for standard balls' : 'No profitable accessible money recovery route',
                recovery:activity ? {resource:'money',amount:purchase.quote+reserve,activity}:undefined};
        }
        return {ready:false,ball,capture,oakItems,purchase,reason:'Buying standard balls'};
    }
    static executePurchase(plan) {
        if (!this.owner?.isCurrent()) return {status:'blocked',reason:'Expired supply session'};
        if (!(Number.isSafeInteger(plan?.quantity) && plan.quantity>0 && plan.quantity<=100 && plan.ball>=0 && plan.ball<=2)) return {status:'blocked',reason:'Invalid standard ball lot'};
        const current=this.shopsForBall(plan.ball).find(s=>s.shop===plan.shop && s.item===plan.item);
        if (!current) return {status:'replan',reason:'Shop unavailable'};
        const stock=Number(this.read(App.game.pokeballs.pokeballs[plan.ball].quantity));
        const wallet=()=>Number(this.read(App.game.wallet.currencies[plan.item.currency]));
        const quote=Number(plan.item.totalPrice(plan.quantity));
        if (stock!==plan.stock || quote!==plan.quote || !Number.isFinite(quote) || quote<0 || wallet()<quote+plan.reserve) return {status:'replan',reason:'Stock, quote or wallet changed'};
        if (typeof player==='undefined' || player.route || player.town!==plan.shop.parent || player.region!==plan.target.region) return {status:'travel',target:plan.target};
        const before=wallet();plan.item.buy(plan.quantity);
        const gained=Number(this.read(App.game.pokeballs.pokeballs[plan.ball].quantity))-stock, spent=before-wallet();
        this.spend ||= {money:0,dungeonToken:0}; this.spend.money+=Math.max(0,spent);
        if (!(gained>0 && gained<=plan.quantity && spent>=0 && spent<=quote && wallet()>=plan.reserve)) return {status:'blocked',reason:'Native purchase inventory or spending delta did not match the quote'};
        return {status:'bought',quantity:gained,spent};
    }
    static applyCapturePolicy(policy) {
        if (!this.owner?.isCurrent() || !(policy.ball===-1 || policy.ball>=0 && policy.ball<=2)) return false;
        const registry=this.registry(), balls=App.game.pokeballs;
        if (!balls?.calculatePokeballToUse) return false;
        if (!this.captureLease) {
            if (registry.captureOwner && registry.captureOwner!==this.owner) return false;
            const adapter=registry.adapters.capture;
            if (adapter && !adapter.acquire(this.owner)) return false;
            registry.captureOwner=this.owner;
            const original=balls.calculatePokeballToUse, owner=this.owner;
            const choose=(id,shiny,shadow,encounter)=>{
                if (!owner.isCurrent()) return undefined;
                const p=this.capturePolicy;
                const pokemon=typeof PokemonHelper==='undefined' ? null : PokemonHelper.getPokemonById(id);
                const ultra=typeof GameConstants.UltraBeastType!=='undefined' && GameConstants.UltraBeastType[pokemon?.name]!==undefined;
                if (ultra) return GameConstants.Pokeball.None;
                // Protect shiny encounters even when a type-only quest excludes their type.
                const relevant=p.type==null || pokemon?.type1===p.type || pokemon?.type2===p.type;
                const ball=shiny && (!relevant || p.ball<0) ? [2,1,0].find(b=>this.read(balls.pokeballs[b]?.quantity)>0) : relevant ? p.ball : -1;
                return ball>=0 && ball<=2 && this.read(balls.pokeballs[ball]?.quantity)>0 ? ball : GameConstants.Pokeball.None;
            };
            const wrapper=function(...args){return choose(...args) ?? original.apply(this,args);};
            registry.capturePolicy=choose;balls.calculatePokeballToUse=wrapper;
            this.captureLease={original,wrapper,choose,owner,adapter};
            if (adapter) adapter.apply(owner,{choose});
        }
        this.capturePolicy={...policy};return true;
    }
    static equipOak(ids) {
        const oak=App.game.oakItems;
        if (!ids.length) return true;
        if (!this.owner?.isCurrent() || !oak || ids.some(id=>!oak.isUnlocked(id)) || ids.length>oak.maxActiveCount()) return false;
        const state=()=>oak.itemList.map((_,i)=>!!oak.isActive(i));
        if (this.oakLease && JSON.stringify(state())!==JSON.stringify(this.oakLease.applied)) {
            this.oakLease=null;this.owner.onManual('Manual Oak equipment change');return false;
        }
        this.oakLease ||= {before:state()};
        for (const id of ids) if (!oak.isActive(id)) {
            if (oak.activeCount?.()>=oak.maxActiveCount() || state().filter(Boolean).length>=oak.maxActiveCount()) {
                const evict=state().findIndex((on,i)=>on && !ids.includes(i)); if (evict>=0) oak.deactivate(evict);
            }
            oak.activate(id);
        }
        this.oakLease.applied=state();return ids.every(id=>oak.isActive(id));
    }
    static releaseSupplies() {
        const lease=this.captureLease, registry=this.registry(), balls=App.game.pokeballs;
        if (lease) {
            lease.adapter?.release(lease.owner);
            if (balls.calculatePokeballToUse===lease.wrapper) balls.calculatePokeballToUse=lease.original;
            if (registry.capturePolicy===lease.choose) delete registry.capturePolicy;
            if (registry.captureOwner===lease.owner) delete registry.captureOwner;
        }
        this.captureLease=null;this.capturePolicy=null;
        const oak=App.game.oakItems, saved=this.oakLease;
        if (saved && JSON.stringify(oak.itemList.map((_,i)=>!!oak.isActive(i)))===JSON.stringify(saved.applied)) {
            saved.before.forEach((on,i)=>{if (!on && oak.isActive(i)) oak.deactivate(i);});
            saved.before.forEach((on,i)=>{if (on && !oak.isActive(i)) oak.activate(i);});
        }
        this.oakLease=null;
    }
    static trackRecovery(snapshot, recovery, now=Date.now()) {
        const value=snapshot.resources[recovery.resource] || 0,key=`${snapshot.epoch}:${recovery.resource}:${recovery.activity.id}`;
        // Nested token -> ball -> money preparation must not reset its leaf clock.
        if (this.recoveryEpoch!==snapshot.epoch || !this.recoveryStates) {this.recoveryEpoch=snapshot.epoch;this.recoveryStates=new Map();}
        let state=this.recoveryStates.get(key);
        if (state && value>state.value) {
            // Earning the leaf prerequisite is useful progress for its waiting parents.
            for (const pending of this.recoveryStates.values()) pending.time=now;
        }
        if (!state || value>state.value) {state={key,value,time:now};this.recoveryStates.set(key,state);}
        this.recoveryState=state;
        if (now-this.recoveryState.time>120000) {this.reason='Resource recovery made no progress for two minutes';return false;}
        return true;
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
        const panel = document.createElement('section');
        panel.id = 'auto-quest-runner-panel';
        panel.className = 'p-2 border-top';
        panel.style.cssText = 'clear:both;text-align:left;font-size:12px;line-height:1.4;';
        const button = document.createElement('button');
        button.id = 'auto-quest-runner'; button.type = 'button';
        button.className = 'btn btn-sm btn-secondary btn-block';
        button.setAttribute('aria-controls','auto-quest-runner-status');
        button.addEventListener('click', () => this.active ? this.stop('Stopped') : this.start());
        const status = document.createElement('div');
        status.id = 'auto-quest-runner-status';
        status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
        status.setAttribute('aria-atomic','true'); status.style.marginTop = '6px';
        panel.append(button,status);
        const questPanel = document.getElementById('questDisplayContainer');
        if (questPanel) questPanel.append(panel);
        else document.querySelector('.battle-view')?.before(panel);
        this.render();
    }
    static start(names = ['navigation']) {
        if (this.active) return false;
        const registry = this.registry();
        if (registry.version !== 1 || names.some(name => !registry.adapters[name])) {
            const missing = names.filter(name => !registry.adapters[name]);
            this.reason = missing.includes('navigation') ? 'Enable Auto Navigation to start Auto Quests'
                : `Enable required modules: ${missing.join(', ') || 'compatible automation adapters'}`;
            this.render(); return false;
        }
        this.active = true; this.reason = null;
        this.sessionStarted = Date.now(); this.sessionQP = 0; this.lastQP = this.questPoints();
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
        this.observation = null; this.observedRates = {}; this.rateSamples = {}; this.listStarted=null;
        this.spend={money:0,dungeonToken:0};this.recoveryState=null;this.recoveryStates=null;this.supplyBlocked=null;
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
        this.visibleQuests = snapshot.quests;
        const stats=App.game.statistics;
        const attempts={battles:Number(this.read(stats?.totalPokemonDefeated))||0,hatches:Number(this.read(stats?.totalPokemonHatched))||0};
        if (!this.attemptBaseline || this.attemptEpoch!==snapshot.epoch) {this.attemptBaseline=attempts;this.attemptEpoch=snapshot.epoch;}
        this.attemptProgress={battles:Math.max(0,attempts.battles-this.attemptBaseline.battles),hatches:Math.max(0,attempts.hatches-this.attemptBaseline.hatches)};
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
            const metric=this.questMetrics[q.type];
            if (activity.capturePolicy?.ball===-1 && ['capture','captureType','tokens','shiny','ball'].includes(metric)) continue;
            const key = `${metric}:${JSON.stringify(q.target)}`;
            const samples = this.rateSamples[activity.id] ||= {};
            const sample = samples[key] ||= {units:0,seconds:0};
            sample.units += Math.max(0,delta); sample.seconds += seconds;
            if (sample.units > 0) rates[key] = sample.units/sample.seconds;
        }
        this.observation = {epoch:snapshot.epoch,time:now,quests:snapshot.quests,activity:activity.id};
    }
    static prepareSupplies(snapshot, primary, nav) {
        const supply=this.planSupplies(snapshot,primary);
        if (!supply.ready && supply.recovery) {
            if (!this.trackRecovery(snapshot,supply.recovery)) return null;
            const recovery=supply.recovery;
            const work={...recovery.activity,recoveryResource:recovery.resource,recoverTokens:recovery.resource==='dungeonToken'};
            // Money recovery never burns balls, so gross native income is profitable.
            const prep=recovery.resource==='money' ? {ready:true,capture:{ball:-1},oakItems:[]} : this.planSupplies(snapshot,work);
            if (!prep.ready) {this.reason=prep.reason;return null;}
            if (App.game.pokeballs?.calculatePokeballToUse) this.applyCapturePolicy(prep.capture);
            this.reason=supply.reason;return {...work,capturePolicy:prep.capture};
        }
        if (!supply.ready) {
            this.reason=supply.reason;
            if (supply.purchase) {
                const key=`${snapshot.epoch}:${supply.purchase.ball}`;
                if (this.supplyBlocked?.key===key) {this.reason=this.supplyBlocked.reason;return null;}
                const result=this.executePurchase(supply.purchase);
                if (result.status==='travel') {
                    nav?.travel?.(this.owner,result.target);this.executing=null;
                } else if (result.status==='blocked') this.supplyBlocked={key,reason:result.reason};
                this.reason=result.reason || supply.reason;
            }
            return null;
        }
        if (!primary.recoveryResource) {this.recoveryState=null;this.recoveryStates=null;}
        if (supply.oakItems.length && !this.equipOak(supply.oakItems)) {this.reason='Oak equipment unavailable or manually changed';return null;}
        if (App.game.pokeballs?.calculatePokeballToUse && !this.applyCapturePolicy(supply.capture)) {this.reason='Capture policy controlled by another session';return null;}
        return {...primary,capturePolicy:supply.capture};
    }
    static executePlan(snapshot, plan) {
        const wanted=new Set((plan.background || []).map(a=>a.module));
        if (plan.primary?.module==='frontier') wanted.add('frontier');
        for (const entry of [...this.acquired]) {
            if (['farm','hatchery','mine','frontier'].includes(entry.name) && !wanted.has(entry.name)) {
                entry.adapter.release(this.owner,'Objective complete');
                this.acquired=this.acquired.filter(e=>e !== entry);
            }
        }
        for (const activity of plan.background || []) {
            const name=activity.module, adapter=this.registry().adapters[name];
            if (!adapter) {plan.reasons.push(`${name} module unavailable`);continue;}
            if (!this.acquired.some(e=>e.name === name)) {
                if (!adapter.acquire(this.owner)) continue;
                this.acquired.push({name,adapter});
            }
            const quest=snapshot.quests.find(q=>activity.questIds?.includes(q.id) && q.active && !q.claimed && q.remaining > 0);
            adapter.apply(this.owner,{...quest?.target,berryType:activity.berryType ?? quest?.target.berryType,type:activity.type ?? quest?.target.type});
        }
        // Hatching and leveling breeders need real route battles even if no route
        // directly contributes to the accepted quests. Farm/mine waits need none.
        if (!plan.primary && (plan.background || []).some(a=>a.module === 'hatchery') && this.acquired.some(e=>e.name === 'hatchery')) {
            const route=snapshot.activities.find(a=>a.unlocked && a.target.kind === 'route');
            if (route) plan.primary={...route,supportsBreeding:true};
        }
        const nav=this.acquired.find(e=>e.name==='navigation')?.adapter;
        let primary=plan.primary, recovering=false;
        // A cost prerequisite is an executable preparation objective, not a dead end.
        if (!primary) {
            const candidates=this.buildCandidates({...snapshot,quests:snapshot.quests.filter(q=>q.active)});
            const blocked=candidates.find(c=>c.entryPrerequisites.length && c.entryPrerequisites.every(p=>['money','dungeonToken'].includes(p.resource)));
            const need=blocked?.entryPrerequisites[0];
            if (need) {
                const activity=this.recoveryActivity(snapshot,need.resource);
                if (activity && this.trackRecovery(snapshot,{...need,activity})) {
                    primary={...activity,recoveryResource:need.resource,recoverTokens:need.resource==='dungeonToken'};recovering=true;
                    this.reason=`Recovering ${need.resource} for ${blocked.id}`;
                }
            }
        }
        if (primary?.target.kind==='frontier') {
            const adapter=this.registry().adapters.frontier;
            if (!adapter) {this.reason='Battle Frontier module unavailable';return;}
            if (!this.acquired.some(e=>e.name==='frontier')) {
                if (!adapter.acquire(this.owner)) {this.reason='Battle Frontier controlled elsewhere';return;}
                this.acquired.push({name:'frontier',adapter});
            }
            adapter.apply(this.owner,{target:primary.target,count:1});
            this.reason=adapter.inspect().reason || 'Working in Battle Frontier';return;
        }
        if (!primary || !['route','gym','dungeon'].includes(primary.target.kind)) {
            this.reason=this.reason?.includes('no progress') ? this.reason : plan.reasons.join(' · ') || 'Waiting for a supported quest activity';return;
        }
        const entry=(primary.requirements || []).find(p=>(snapshot.resources[p.resource] || 0)<p.amount);
        if (entry) {
            const activity=this.recoveryActivity(snapshot,entry.resource);
            if (!activity || !this.trackRecovery(snapshot,{...entry,activity})) {this.reason ||= `No accessible recovery for ${entry.resource}`;return;}
            primary={...activity,recoveryResource:entry.resource,recoverTokens:entry.resource==='dungeonToken'};recovering=true;
            this.reason=`Recovering ${entry.resource}`;
        }
        const recoveryReason=this.reason;
        if (primary.target.kind==='route' || primary.capabilities?.includes('shadow')) {
            primary=this.prepareSupplies(snapshot,primary,nav);
            if (!primary) return;
        }
        plan.primary=primary;
        const inspection=nav?.inspect();
        if (inspection?.status==='blocked') {this.reason=inspection.reason || 'Navigation blocked';return;}
        if (this.executing?.epoch===snapshot.epoch && this.executing.id===primary.id && !['done','ready'].includes(inspection?.status)) return;
        if (this.apply('navigation',{target:primary.target,count:1,session:{moneyBudget:Number.MAX_SAFE_INTEGER,
            tokenBudget:Number.MAX_SAFE_INTEGER,minutes:1440,stallMinutes:1440}})) {
            this.executing={id:primary.id,epoch:snapshot.epoch};
            this.reason=recovering ? recoveryReason : this.reason?.startsWith('Earning') ? this.reason : primary.reason || 'Working';
        } else this.reason='Navigation objective unavailable';
    }
    static evaluateRefresh(snapshot, estimates = {}) {
        const now=estimates.now ?? Date.now();
        if (now < (this.refreshAfter || 0)) return {refresh:false,reason:'Refresh cooldown'};
        const remaining=snapshot.quests.filter(q=>!q.claimed && q.remaining>0);
        if (!remaining.length || snapshot.quests.some(q=>!q.claimed && q.remaining===0)) return {refresh:false,reason:'Native completion pending'};
        const candidates=this.buildCandidates(snapshot);
        const realizable=remaining.some(q=>candidates.some(c=>c.questIds.includes(q.id) && (
            c.exploratory || c.seconds>0 || c.prerequisites.some(p=>['commitment','guide'].includes(p.resource)) ||
            // Execution can earn entry currencies before a completion rate is
            // known. Token recovery may first earn money for standard balls.
            // Keep that supported preparation path rather than discard it here.
            c.entryPrerequisites.length>0 && c.entryPrerequisites.every(p=>
                ['money','dungeonToken'].includes(p.resource) && this.recoveryActivity(snapshot,p.resource))
        )));
        const cost=Math.max(0,Number(estimates.refreshCost)||0);
        if (!realizable && !cost) return {refresh:true,reason:'No executable current quest, free fallback'};
        if (!(estimates.observations>=2 && estimates.currentSeconds>0 && estimates.nextSeconds>0 && estimates.nextReward>0))
            return {refresh:false,reason:'Prefer current quests while opportunity estimates are unknown'};
        const recovery=cost ? estimates.moneyRate>0 ? cost/estimates.moneyRate : Infinity : 0;
        const currentReward=remaining.reduce((n,q)=>n+q.reward,0)+Math.max(0,estimates.currentBonus || 0);
        const currentRate=currentReward/estimates.currentSeconds;
        const nextRate=estimates.nextReward/(estimates.nextSeconds+recovery);
        return {refresh:Number.isFinite(nextRate) && nextRate>currentRate*1.25,currentRate,nextRate,reason:'Compare remaining rewards and list bonus including refresh cost recovery'};
    }
    static refreshEstimates(snapshot) {
        const candidates=this.buildCandidates(snapshot),remaining=snapshot.quests.filter(q=>!q.claimed && q.remaining>0);
        const seconds=remaining.map(q=>Math.min(...candidates.filter(c=>c.questIds.includes(q.id) && c.seconds>0).map(c=>c.seconds)));
        const samples=this.listOpportunities || [];
        return {// Optimistic current-list lower bound avoids double counting synergy and
            // concurrent modules. Bias toward retaining current work when unsure.
            currentSeconds:seconds.length && seconds.every(Number.isFinite) ? Math.max(...seconds) : null,
            currentBonus:Number(App.game.quests.calcListBonus?.()) || 0,observations:samples.length,
            nextReward:samples.length ? samples.reduce((s,x)=>s+x.reward,0)/samples.length : 0,
            nextSeconds:samples.length ? samples.reduce((s,x)=>s+x.seconds,0)/samples.length : 0,
            moneyRate:Math.max(0,...snapshot.activities.filter(a=>a.unlocked).map(a=>this.prepareActivity(a,snapshot).rates?.money || 0))};
    }
    static tryRefresh(snapshot, estimates = {}) {
        const native=App.game.quests;
        if (!this.owner?.isCurrent() || this.refreshPending || typeof native?.refreshQuests!=='function') return false;
        const free=!!this.read(native.freeRefresh),cost=free ? 0 : Number(native.getRefreshCost?.().amount);
        if (!(Number.isFinite(cost) && cost>=0)) return false;
        const decision=this.evaluateRefresh(snapshot,{...this.refreshEstimates(snapshot),...estimates,refreshCost:cost});
        if (!decision.refresh || cost>0 && !native.canAffordRefresh?.()) return false;
        // Cancel old-list work before the native mutation, including pending navigation.
        for (const entry of [...this.acquired]) if (['frontier','navigation'].includes(entry.name)) {
            entry.adapter.release(this.owner,'Quest list refresh');
            this.acquired=this.acquired.filter(e=>e!==entry);
        }
        this.releaseSupplies();this.executing=null;
        const owner=this.owner,nav=this.registry().adapters.navigation;
        if (nav?.acquire(owner)) this.acquired.push({name:'navigation',adapter:nav});
        this.refreshAfter=(estimates.now ?? Date.now())+300000;this.refreshPending=true;
        try {
            const result=native.refreshQuests(free,false);
            Promise.resolve(result).then(()=>{this.refreshPending=false;},error=>{this.refreshPending=false;if (owner.isCurrent()) this.reason=`Native refresh failed: ${error.message}`;});
        } catch (error) {this.refreshPending=false;throw error;}
        this.listStarted=null;return true;
    }
    static tick(owner = this.owner) {
        if (!owner?.isCurrent() || this.ticking) return;
        this.ticking = true;
        try {
            let snapshot = this.readQuestSnapshot(this.planningContext());
            this.observeProgress(snapshot);
            this.listStarted ||= {epoch:snapshot.epoch,time:Date.now(),whole:snapshot.quests.every(q=>!q.claimed && q.remaining===q.amount)};
            if (this.listStarted.epoch!==snapshot.epoch) this.listStarted={epoch:snapshot.epoch,time:Date.now(),whole:snapshot.quests.every(q=>!q.claimed && q.remaining===q.amount)};
            // Native final claim may synchronously replace the list. Perform one
            // claim per pass and rediscover before any subsequent native action.
            for (const entry of snapshot.quests.filter(q => q.active && !q.claimed && !q.remaining)) {
                const current = this.resolveQuest(entry,snapshot.epoch);
                if (!owner.isCurrent() || !current || this.confirmedClaims.has(current.native)) continue;
                const listBonus=Number(App.game.quests.calcListBonus?.())||0;
                App.game.quests.claimQuest(this.questObjects.indexOf(current.native));
                const after = this.readQuestSnapshot(this.planningContext());
                if (this.read(current.native.claimed) || !after.quests.some(q => q.native === current.native)) {
                    this.confirmedClaims.add(current.native);
                    if (snapshot.quests.every(q=>q.native===current.native || this.read(q.native.claimed))) {
                        this.refreshAfter=Date.now()+300000;
                        const seconds=(Date.now()-(this.listStarted?.time || Date.now()))/1000;
                        if (seconds>0 && this.listStarted?.whole) {
                            this.listOpportunities ||= [];
                            this.listOpportunities.push({seconds,reward:snapshot.quests.reduce((s,q)=>s+q.reward,0)+listBonus});
                            this.listOpportunities=this.listOpportunities.slice(-10);
                        }
                    }
                }
                // A deferred native completion computed may have refused this
                // attempt. Leave it eligible on a later reconciliation pass.
                // The ticking guard prevents reentrant attempts in this pass.
                return;
            }
            const slots = this.registry().adapters.quests?.inspect().slots ?? (Number(this.read(App.game.quests.questSlots)) || 1);
            for (const entry of this.acceptanceOrder(snapshot)) {
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
            if (this.tryRefresh(snapshot)) return;
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
        this.releaseSupplies();
        this.owner.active = false; this.active = false;
        clearInterval(this.timer); this.timer = null;
        for (const {adapter} of this.acquired.reverse()) {
            try { adapter.release(this.owner, reason); } catch (error) { console.error('[Auto Quest Runner]', error); }
        }
        this.acquired = []; this.reason = reason; this.render();
    }
    static questPoints() {
        const currency = typeof GameConstants === 'undefined' ? null : GameConstants.Currency?.questPoint;
        return currency == null ? 0 : Number(this.read(App.game.wallet?.currencies?.[currency])) || 0;
    }
    static render() {
        const button = document.getElementById('auto-quest-runner');
        if (button) {
            button.textContent = `Auto Quests: ${this.active ? 'ON' : 'OFF'}`;
            button.setAttribute('aria-pressed',String(this.active));
            button.className = `btn btn-sm btn-block btn-${this.active ? 'success' : 'secondary'}`;
        }
        const status = document.getElementById('auto-quest-runner-status');
        if (!status) return;
        const lines = [];
        const primary = this.currentPlan?.primary;
        const target = primary?.target;
        const action = !this.active ? 'Ready when enabled' : target?.kind === 'route' ? `Route ${target.number} (region ${target.region + 1})`
            : target ? `${target.kind}: ${target.name || target.gym || ''}` : 'Planning quests';
        lines.push(`${this.active ? 'Working' : 'OFF'} · ${action}`);
        const readable = text => text.replace(/^(\d+:\d+):\s*/, (_,id) => {
            const quest = (this.visibleQuests || []).find(q => q.id === id);
            return quest ? `${quest.type.replace(/Quest$/,'').replace(/([a-z])([A-Z])/g,'$1 $2')}: ` : '';
        })
            .replace(/route:\d+:(\d+)/g, 'Route $1').replace(/farm:points/g,'Farming').replace(/farm:\d+/g,'Berry farming')
            .replace(/hatchery:/g,'Hatchery:').replace(/mine:/g,'Mining:').replace(/native prior/g,'game mechanics estimate')
            .replace(/observed/g,'measured progress').replace(/unknown/g,'not yet measured')
            .replace(/Progress estimate unavailable, observe useful attempts/g,'Learning from quest progress');
        if (this.reason) {
            const reason = this.reason.includes(' · ') && this.reason.length > 180 ? 'Waiting for available quest work. See quest limits below.' : readable(this.reason);
            lines.push(reason.length > 180 ? `${reason.slice(0,177)}…` : reason);
        }
        if (this.sessionStarted != null) {
            const qp = this.questPoints();
            this.sessionQP += Math.max(0,qp-this.lastQP); this.lastQP = qp;
            const minutes = (Date.now()-this.sessionStarted)/60000;
            lines.push(`Session: ${this.sessionQP} QP gained · ${minutes > 0 ? (this.sessionQP/minutes).toFixed(1) : '—'} QP/min observed`);
            const balls = App.game.pokeballs?.pokeballs || [];
            lines.push(`Supplies: ${['Poké Ball','Great Ball','Ultra Ball'].map((name,i) => `${name} ${Number(this.read(balls[i]?.quantity)) || 0}`).join(' · ')}`);
            lines.push(`Supply spend: ${this.spend?.money || 0} money`);
            const navigationCosts = this.acquired.find(entry => entry.name === 'navigation')?.adapter.inspect?.().costs;
            if (navigationCosts) lines.push(`Navigation spend: ${navigationCosts.money || 0} money · ${navigationCosts.dungeonToken || 0} dungeon tokens (current navigation session)`);
        }
        if (this.active) {
            for (const {name,adapter} of this.acquired.filter(e => ['farm','hatchery','mine'].includes(e.name))) {
                const state = adapter.inspect();
                const label = {farm:'Farming',hatchery:'Hatchery',mine:'Mining'}[name];
                const unit = {farm:'plots harvested this check',hatchery:'breeders added this check',mine:'layers mined in total'}[name];
                lines.push(`${label}: ${state.status}${state.reason ? ` · ${state.reason}` : ''}${typeof state.progress === 'number' && state.progress > 0 ? ` · ${state.progress} ${unit}` : ''}`);
            }
            if (primary) lines.push(`Completion estimate: ${readable(primary.estimateSource || 'unknown')}`);
            const attempts = this.attemptProgress;
            const shinies = (this.visibleQuests || []).filter(q => q.type === 'CatchShiniesQuest');
            if (shinies.length) lines.push(`Shiny quest progress: ${Math.max(...shinies.map(q => Math.max(0,q.amount-q.remaining)))} successful captures`);
            if (attempts) lines.push(`This list: ${attempts.battles} battles · ${attempts.hatches} hatches (attempts, not shiny captures). Random rewards have no guaranteed time.`);
            const selected = [primary,...(this.currentPlan?.background || [])].filter(Boolean);
            const reasons = [...new Set(this.currentPlan?.reasons || [])].filter(reason =>
                /^\d+:\d+:/.test(reason) || /module unavailable/.test(reason) || selected.some(activity => reason.startsWith(`${activity.id}:`)))
                .filter(reason => !/Progress estimate unavailable, observe useful attempts/.test(reason));
            if (reasons.length) lines.push(`Waiting / limits: ${reasons.slice(0,3).map(readable).join(' · ')}${reasons.length > 3 ? ` · ${reasons.length-3} more quest limits` : ''}`);
        }
        // Stable text avoids repeatedly announcing the same status every tick.
        if (status.dataset.text !== lines.join('\n')) {
            status.replaceChildren(...lines.map(text => {
                const line = document.createElement('div'); line.textContent = text; return line;
            }));
            status.dataset.text = lines.join('\n');
        }
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
