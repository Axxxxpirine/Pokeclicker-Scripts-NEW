const test = require('node:test');
const assert = require('node:assert/strict');
const {load, observable:o} = require('./helpers.cjs');
function setup(storage = {}) {
    const state = {town:0,fighting:1,dungeon:2,gym:3,safari:4,battleFrontier:5};
    const route = (number,unlocked=true) => ({number,region:0,isUnlocked:()=>unlocked});
    const routes = [route(1),route(2,false),route(3)];
    const d = {name:'Forest',tokenCost:10,isUnlocked:()=>true,hasUnlockedBoss:()=>true,allAvailablePokemon:()=>['A']};
    const town = {name:'Home',region:0,subRegion:0,content:[],isUnlocked:()=>true};
    const forest = {...town,name:'Forest',dungeon:d};
    const stats = {routeKills:[[o(0),o(0),o(0),o(0)]],dungeonsCleared:[o(0)],gymsDefeated:[o(0)]};
    const game = {gameState:state.town,statistics:stats,wallet:{currencies:[o(100),o(100)]},party:{getPokemonByName:()=>null},quests:{currentQuests:()=>[]},pokeballs:{calculatePokeballToUse:()=>0,pokeballs:[]}};
    const player = {route:0,region:0,subregion:0,town,highestRegion:()=>0,itemList:{}};
    let c;
    const eac = {navigationVersion:1,autoClickState:o(false),autoGymState:o(false),autoDungeonState:o(false),autoDungeonEncounterMode:false,autoDungeonChestMode:false,autoDungeonAlwaysOpenRareChests:false,autoGymSelect:0,autoDungeonTracker:{},
        toggleAutoClick(){this.autoClickState(!this.autoClickState());},toggleAutoGym(){this.autoGymState(!this.autoGymState());},toggleAutoDungeon(){this.autoDungeonState(!this.autoDungeonState());},autoDungeon(){}};
    const move = (name)=>{player.route=0;player.town=towns[name];player.region=player.town.region;game.gameState=state.town;};
    const towns={Home:town,Forest:forest};
    const globals={App:{isUsingClient:true,game},player,EnhancedAutoClicker:eac,GameConstants:{GameState:state,Currency:{money:0,dungeonToken:1},Pokerus:{Contagious:2,Resistant:3},getDungeonIndex:()=>0,getGymIndex:()=>0},
      MapHelper:{accessToRoute:(n,region)=>routes.find(r=>r.number===n&&r.region===region)?.isUnlocked(),accessToTown:n=>!!towns[n]?.isUnlocked(),moveToTown:move,moveToRoute(n,r){player.route=n;player.region=r;game.gameState=state.fighting;}},Routes:{regionRoutes:routes},RouteHelper:{getAvailablePokemonList:()=>['A']},TownList:towns,GymList:{},DungeonGuides:{hired:()=>false},
      DungeonRunner:{dungeonID:0,dungeonFinished:o(false),fightingBoss:o(false),defeatedBoss:o(null),canStartDungeon:x=>x.hasUnlockedBoss(),dungeonWon(){if(!this.dungeonFinished()){this.dungeonFinished(true);this.returnToTown();}},dungeonLost(){this.dungeonFinished(true);this.returnToTown();},dungeonLeave(){this.dungeonFinished(true);this.returnToTown();},initializeDungeon(x){this.dungeonID++;this.dungeonFinished(false);game.wallet.currencies[1](game.wallet.currencies[1]()-x.tokenCost);game.gameState=state.dungeon;this.dungeon=x;},returnToTown(){c.w.MapHelper.moveToTown('Forest');},fighting:o(false)},GymRunner:{autoRestart:o(false),startGym(){game.gameState=state.gym;}},Battle:{catching:()=>false},DungeonBattle:{catching:()=>false},Preload:{hideSplashScreen(){}},Shop:class Shop{},ItemList:{},PokemonType:{},pokemonMap:{},Notifier:{notify(){}},NotificationConstants:{NotificationOption:{warning:'warning'}}};
    c=load('autonavigation.user.js','<div class="battle-view"></div>',globals,storage);
    c.run('AutoNavigator.init()');
    const nav=c.run('AutoNavigator');
    return {...c,nav,game,player,eac,stats,d,towns,state,routes,globals};
}
const settings={mode:'routes',target:2,moneyBudget:0,tokenBudget:20,moneyReserve:0,tokenReserve:0,minutes:60,stallMinutes:2,pokemon:'',item:'Pokeball',stock:10};
test('routes skip locked targets, finish at exact threshold and restore origin and modes',()=>{
 const f=setup();f.eac.autoClickState(true);f.nav.start(settings);assert.equal(f.player.route,1);
 f.stats.routeKills[0][1](2);f.nav.tick(true);assert.equal(f.player.route,3);
 f.stats.routeKills[0][3](2);f.nav.tick(true);assert.equal(f.nav.active,false);assert.equal(f.player.town.name,'Home');assert.equal(f.player.route,0);assert.equal(f.eac.autoClickState(),true);
});
test('manual movement cancels without returning or restarting a competing mode',()=>{
 const f=setup();f.eac.autoGymState(true);f.nav.start(settings);f.w.MapHelper.moveToRoute(3,0);
 assert.equal(f.nav.active,false);assert.equal(f.player.route,3);assert.equal(f.eac.autoGymState(),false);
});
test('dungeon entry debits a finite budget and never enters again beyond it',()=>{
 const f=setup();f.nav.start({...settings,mode:'dungeons',target:50,tokenBudget:20});
 assert.equal(f.game.wallet.currencies[1](),90);
 f.stats.dungeonsCleared[0](1);f.w.DungeonRunner.dungeonWon();f.nav.tick(true);
 assert.equal(f.game.wallet.currencies[1](),80);
 f.stats.dungeonsCleared[0](2);f.w.DungeonRunner.dungeonWon();f.nav.tick(true);
 assert.equal(f.game.wallet.currencies[1](),80);assert.equal(f.nav.active,false);
});
test('reserve blocks entry even when the session budget can afford it',()=>{
 const f=setup();f.nav.start({...settings,mode:'dungeons',tokenReserve:95});
 assert.equal(f.game.wallet.currencies[1](),100);assert.equal(f.nav.active,false);
});
test('stalled route is skipped and all stalled targets end the session',()=>{
 const f=setup();f.nav.start(settings);f.nav.lastProgressAt=Date.now()-121000;f.nav.tick(true);assert.equal(f.player.route,3);
 f.nav.lastProgressAt=Date.now()-121000;f.nav.tick(true);assert.equal(f.nav.active,false);
});
test('Pokérus ignores uncaught and healthy species and only uses currently available encounters',()=>{
 const f=setup();f.game.party.getPokemonByName=n=>n==='Unavailable'?{pokerus:2,effortPoints:0}:{pokerus:1,effortPoints:0};
 f.nav.start({...settings,mode:'routePokerus'});assert.equal(f.nav.active,false);
 f.game.party.getPokemonByName=()=>({pokerus:2,effortPoints:0});f.nav.start({...settings,mode:'routePokerus'});assert.equal(f.nav.active,true);
});
test('invalid settings cannot replace an active run or allow non-finite budgets',()=>{
 const f=setup();f.nav.start(settings);assert.equal(f.nav.start({...settings,tokenBudget:Infinity}),false);assert.equal(f.nav.active,true);
});
test('deadline stops before a further dungeon purchase',()=>{
 const f=setup();f.nav.start({...settings,mode:'dungeons'});f.w.DungeonRunner.dungeonWon();f.nav.deadline=Date.now()-1;f.nav.tick(true);
 assert.equal(f.game.wallet.currencies[1](),90);assert.equal(f.nav.active,false);
});
test('current dungeon repetitions count new clears rather than lifetime clears',()=>{
 const f=setup();f.w.MapHelper.moveToTown('Forest');f.stats.dungeonsCleared[0](80);f.nav.start({...settings,mode:'dungeonRuns',target:1});
 f.stats.dungeonsCleared[0](81);f.w.DungeonRunner.dungeonWon();f.nav.tick(true);assert.equal(f.nav.active,false);assert.equal(f.game.wallet.currencies[1](),90);
});
test('unsupported and locked quests are skipped for an accessible active location quest',()=>{
 const f=setup();const quest=(route,type='DefeatPokemonsQuest')=>({constructor:{name:type},route,region:0,isCompleted:()=>false,inProgress:()=>true,progress:()=>0});
 const quests=[quest(1,'UnknownQuest'),quest(2),quest(3)];f.game.quests.currentQuests=()=>quests;f.nav.start({...settings,mode:'quests'});assert.equal(f.player.route,3);
});
test('refresh does not resume a session and leaves spending modes off',()=>{
 const f=setup();f.nav.start(settings);assert.equal(f.w.localStorage.getItem('autoDungeonState'),'false');assert.equal(f.w.localStorage.getItem('autoClickState'),'false');
});
test('clicking Auto Click OFF during navigation stays OFF after snapshot restoration',()=>{
 const f=setup();const fs=require('node:fs');const body=fs.readFileSync(require('node:path').join(__dirname,'../enhancedautoclicker.user.js'),'utf8').match(/static toggleAutoClick\(\) \{([\s\S]*?)\n    \}/)[1];
 f.eac.toggleAutoClickerLoop=()=>{};const button=f.w.document.createElement('button');button.id='auto-click-start';f.w.document.body.append(button);
 f.run('EnhancedAutoClicker.toggleAutoClick=function(){'+body+'}');
 f.nav.start(settings);assert.equal(f.eac.autoClickState(),true);f.eac.toggleAutoClick();assert.equal(f.nav.active,false);assert.equal(f.eac.autoClickState(),false);
});
test('shop waits for base price and never spends an inflated quote',()=>{
 const f=setup();let stock=0;const item={basePrice:10,currency:0,getBagAmount:()=>stock,isAvailable:()=>true,isSoldOut:()=>false,totalPrice:()=>20,buy:()=>stock++};
 f.w.ItemList.Pokeball=item;f.towns.Home.content=[Object.assign(new f.w.Shop(),{items:[item],isUnlocked:()=>true})];
 f.nav.start({...settings,mode:'shop',moneyBudget:100});assert.equal(stock,0);assert.equal(f.nav.active,true);
 item.totalPrice=()=>10;f.nav.tick(true);assert.equal(stock,1);
});
test('purification uses native flow, restores selection and stops with no shadows',()=>{
 const f=setup();const selected=o(undefined),mon={shadow:1};f.w.GameConstants.ShadowStatus={Shadow:1,Purified:2};
 f.game.party.caughtPokemon=[mon];let calls=0;f.game.purifyChamber={selectedPokemon:selected,currentFlow:()=>100,flowNeeded:()=>100,canPurify:()=>true,purify(){calls++;mon.shadow=2;}};
 f.w.PurifyChamber={requirements:{isCompleted:()=>true}};
 f.nav.start({...settings,mode:'purify'});assert.equal(calls,1);assert.equal(selected(),undefined);f.nav.tick(true);assert.equal(f.nav.active,false);
});
test('capture in progress finishes before switching route',()=>{
 const f=setup();f.w.Battle.catching=()=>true;f.nav.start(settings);assert.equal(f.player.route,0);
 f.w.Battle.catching=()=>false;f.nav.tick(true);assert.equal(f.player.route,1);
});
test('an externally started dungeon cancels a route objective immediately',()=>{
 const f=setup();f.nav.start(settings);f.w.DungeonRunner.initializeDungeon(f.d);f.nav.tick(true);assert.equal(f.nav.active,false);
});
test('direct location changes cannot silently keep an objective active',()=>{
 const f=setup();f.nav.start(settings);f.player.route=3;f.nav.tick(true);assert.equal(f.nav.active,false);assert.equal(f.player.route,3);
});
test('manual exit through the dungeon entrance cancels instead of re-entering',()=>{
 const f=setup();f.nav.start({...settings,mode:'dungeons',target:50});f.w.DungeonRunner.dungeonLeave();f.nav.tick(true);
 assert.equal(f.nav.active,false);assert.equal(f.game.wallet.currencies[1](),90);
});
test('pending dungeon completion cannot steal location after Stop & return',()=>{
 const f=setup();f.nav.start({...settings,mode:'dungeons',target:50});f.w.DungeonRunner.defeatedBoss('Boss');f.nav.stop();
 assert.equal(f.player.town.name,'Home');f.w.DungeonRunner.dungeonWon();assert.equal(f.player.town.name,'Home');assert.equal(f.w.DungeonRunner.defeatedBoss(),null);
});
test('manual travel aborts pending completion and does not teleport back',()=>{
 const f=setup();f.nav.start({...settings,mode:'dungeons',target:50});f.w.MapHelper.moveToRoute(1,0);f.w.DungeonRunner.dungeonWon();assert.equal(f.player.route,1);
});
test('temporarily locked bosses never consume entry budget',()=>{
 const f=setup();f.d.hasUnlockedBoss=()=>false;f.nav.start({...settings,mode:'dungeons',target:50});assert.equal(f.nav.spent.dungeonToken,0);assert.equal(f.game.wallet.currencies[1](),100);
});
test('native refused entry is skipped without charging its quote',()=>{
 const f=setup();f.w.DungeonRunner.initializeDungeon=()=>false;f.nav.start({...settings,mode:'dungeons',target:50});f.nav.tick(true);assert.equal(f.nav.spent.dungeonToken,0);assert.equal(f.nav.active,false);assert.equal(f.nav.skipped.size,1);
});
test('replaced quest list does not inherit a skipped quest at the same index',()=>{
 const f=setup();const quest=n=>({constructor:{name:'DefeatPokemonsQuest'},route:n,region:0,isCompleted:()=>false,inProgress:()=>true,focus:()=>0});let list=[quest(1),quest(3)];f.game.quests.currentQuests=()=>list;
 f.nav.start({...settings,mode:'quests'});f.nav.lastProgressAt=Date.now()-121000;f.nav.tick(true);assert.equal(f.player.route,3);
 list=[quest(1)];f.nav.tick(true);assert.equal(f.nav.active,true);assert.equal(f.player.route,1);
});

function tracked(f, kind = 'route', requiredValue = 3) {
 const base = class { constructor(value) { this.requiredValue=value; this.option=0; } isCompleted(){return this.getProgress()>=this.requiredValue;} };
 f.w.RouteKillRequirement=class extends base {constructor(value,region,route){super(value);this.region=region;this.route=route;}getProgress(){return f.stats.routeKills[this.region][this.route]();}};
 f.w.ClearGymRequirement=class extends base {constructor(value,index){super(value);this.gymIndex=index;}getProgress(){return f.stats.gymsDefeated[this.gymIndex]();}};
 f.w.ClearDungeonRequirement=class extends base {constructor(value,index){super(value);this.dungeonIndex=index;}getProgress(){return f.stats.dungeonsCleared[this.dungeonIndex]();}};
 f.w.GameConstants.AchievementOption={more:0};
 const property=kind==='route'?new f.w.RouteKillRequirement(requiredValue,0,1):kind==='gym'?new f.w.ClearGymRequirement(requiredValue,0):new f.w.ClearDungeonRequirement(requiredValue,0);
 const achievement={name:'Native achievement',property,isCompleted:()=>property.isCompleted(),achievable:()=>true};
 f.game.achievementTracker={trackedAchievement:o(achievement)};
 return achievement;
}

function league(f) {
 const town={...f.towns.Home,name:'League',content:[]};f.towns.League=town;
 const names=['Elite One','Elite Two','Champion'];
 for (const [index,name] of names.entries()) {
  const gym={town:name,parent:town,isUnlocked:()=>true,flags:{champion:index===2}};
  f.w.GymList[name]=gym;town.content.push(gym);f.stats.gymsDefeated[index]=o(100+index);
 }
 f.w.GameConstants.getGymIndex=name=>names.indexOf(name);
 f.w.GymRunner.gymObservable=o(null);f.w.GymRunner.running=o(false);
 const starts=[];
 f.w.GymRunner.startGym=(gym,autoRestart)=>{starts.push(gym.town);f.w.GymRunner.gymObservable(gym);f.w.GymRunner.autoRestart(autoRestart);f.w.GymRunner.running(true);f.game.gameState=f.state.gym;};
 f.w.MapHelper.moveToTown('League');
 const finish=(won=true)=>{const gym=f.w.GymRunner.gymObservable();if(won){const count=f.stats.gymsDefeated[names.indexOf(gym.town)];count(count()+1);}f.w.GymRunner.running(false);f.game.gameState=f.state.town;f.nav.tick(true);};
 return {town,names,starts,finish};
}

test('tracked route achievement uses the native requirement and never chases the next tier',()=>{
 const f=setup();const achievement=tracked(f);assert.equal(f.nav.start({...settings,mode:'achievement',target:1}),true);
 f.stats.routeKills[0][1](2);f.nav.tick(true);assert.equal(f.nav.active,true);
 f.stats.routeKills[0][1](3);f.game.achievementTracker.trackedAchievement({name:'Next tier'});f.nav.tick(true);
 assert.equal(f.nav.active,false);assert.equal(f.player.town.name,'Home');assert.notEqual(f.game.achievementTracker.trackedAchievement(),achievement);
});
test('unsupported, locked and absent tracked achievements fail clearly before changing automation',()=>{
 for(const variant of ['absent','unsupported','locked']){
  const f=setup();if(variant==='unsupported')f.game.achievementTracker={trackedAchievement:()=>({property:{},isCompleted:()=>false})};
  if(variant==='locked'){const a=tracked(f);a.property.route=2;}
  assert.equal(f.nav.start({...settings,mode:'achievement'}),false);assert.equal(f.eac.autoClickState(),false);
  assert.match(f.nav.message,/achievement|supported|accessible/i);
 }
});
test('tracked gym and dungeon achievements resolve native indices and honour token budget',()=>{
 const f=setup();const l=league(f);tracked(f,'gym',101);
 assert.equal(f.nav.start({...settings,mode:'achievement'}),true);assert.equal(l.starts[0],'Elite One');l.finish();assert.equal(f.nav.active,false);
 const d=setup();tracked(d,'dungeon',2);d.nav.start({...settings,mode:'achievement',tokenBudget:10});
 d.stats.dungeonsCleared[0](1);d.w.DungeonRunner.dungeonWon();d.nav.tick(true);assert.equal(d.nav.active,false);assert.equal(d.game.wallet.currencies[1](),90);
});
test('changing the tracked achievement manually cancels its navigation session',()=>{
 const f=setup();tracked(f);f.nav.start({...settings,mode:'achievement'});
 f.game.achievementTracker.trackedAchievement(null);f.nav.tick(true);assert.equal(f.nav.active,false);assert.match(f.nav.message,/changed/i);
});
test('league cycles follow native town order and count new wins with uneven lifetime totals',()=>{
 const f=setup();const l=league(f);assert.equal(f.nav.start({...settings,mode:'league',target:2}),true);
 for(let i=0;i<6;i++)l.finish();
 assert.deepEqual(l.starts,[...l.names,...l.names]);assert.equal(f.nav.active,false);assert.equal(f.player.town.name,'League');
 assert.equal(f.w.GymRunner.autoRestart(),false);assert.equal(f.nav.spent.money,0);
});
test('league requires a native league town and does not silently omit a locked member',()=>{
 const f=setup();assert.equal(f.nav.start({...settings,mode:'league'}),false);assert.match(f.nav.message,/league/i);
 const l=league(f);f.nav.start({...settings,mode:'league'});f.w.GymList['Elite Two'].isUnlocked=()=>false;l.finish();
 assert.equal(f.nav.active,false);assert.deepEqual(l.starts,['Elite One']);assert.match(f.nav.message,/locked|accessible/i);
});
test('league loss retries the same member until the no-progress limit and stop cancels native running',()=>{
 const f=setup();const l=league(f);f.nav.start({...settings,mode:'league'});l.finish(false);
 assert.deepEqual(l.starts,['Elite One','Elite One']);f.nav.lastProgressAt=Date.now()-121000;f.nav.tick(true);
 assert.equal(f.nav.active,false);assert.equal(f.w.GymRunner.running(),false);
});
test('current-zone capture uses native caught state and waits for a pending capture before stopping',()=>{
 const f=setup();const caught=new Set();f.game.party.alreadyCaughtPokemonByName=n=>caught.has(n);f.w.RouteHelper.getAvailablePokemonList=()=>['A','B'];
 f.w.MapHelper.moveToRoute(3,0);assert.equal(f.nav.start({...settings,mode:'zoneCapture',target:20}),true);
 caught.add('A');f.nav.tick(true);assert.equal(f.nav.active,true);assert.equal(f.player.route,3);
 caught.add('B');f.w.Battle.catching=()=>true;f.nav.tick(true);assert.equal(f.nav.active,true);
 f.w.Battle.catching=()=>false;f.nav.tick(true);assert.equal(f.nav.active,false);assert.equal(f.player.route,3);
});
test('current-zone shiny capture only accepts native shiny ownership and is bounded by new defeats',()=>{
 const f=setup();const checks=[];f.game.party.alreadyCaughtPokemonByName=(name,shiny)=>{checks.push(shiny);return !shiny;};
 f.w.MapHelper.moveToRoute(1,0);f.stats.routeKills[0][1](500);f.nav.start({...settings,mode:'zoneShiny',target:2});
 assert.equal(f.nav.active,true);f.stats.routeKills[0][1](502);f.nav.tick(true);
 assert.equal(f.nav.active,false);assert.ok(checks.every(Boolean));assert.match(f.nav.message,/limit/i);
});
test('current dungeon collection caps paid entries even after losses and respects its origin',()=>{
 const f=setup();f.game.party.alreadyCaughtPokemonByName=()=>false;f.w.MapHelper.moveToTown('Forest');
 f.nav.start({...settings,mode:'zoneShiny',target:1,tokenBudget:100});assert.equal(f.game.wallet.currencies[1](),90);
 f.w.DungeonRunner.dungeonLost();f.nav.tick(true);assert.equal(f.nav.active,false);assert.equal(f.game.wallet.currencies[1](),90);assert.equal(f.player.town.name,'Forest');
});
test('zone objectives recheck available species and refuse ordinary towns',()=>{
 const f=setup();f.game.party.alreadyCaughtPokemonByName=()=>false;assert.equal(f.nav.start({...settings,mode:'zoneCapture'}),false);
 f.w.MapHelper.moveToRoute(1,0);f.nav.start({...settings,mode:'zoneCapture'});f.w.RouteHelper.getAvailablePokemonList=()=>[];f.nav.tick(true);assert.equal(f.nav.active,false);
});
test('shiny search stops on deadline and manual travel without changing ball settings',()=>{
 const f=setup();f.game.party.alreadyCaughtPokemonByName=()=>false;f.w.MapHelper.moveToRoute(1,0);
 const balls=f.game.pokeballs;f.nav.start({...settings,mode:'zoneShiny'});f.nav.deadline=Date.now()-1;f.nav.tick(true);assert.equal(f.nav.active,false);
 f.nav.start({...settings,mode:'zoneShiny'});f.w.MapHelper.moveToRoute(3,0);assert.equal(f.nav.active,false);assert.equal(f.player.route,3);assert.equal(f.game.pokeballs,balls);
});
test('zone dungeon traversal covers encounters and chests only during its call and restores preferences',()=>{
 const f=setup();f.game.party.alreadyCaughtPokemonByName=()=>false;f.w.MapHelper.moveToTown('Forest');
 f.eac.autoDungeonLootTier=3;let seen;
 f.eac.autoDungeon=()=>{seen=[f.eac.autoDungeonEncounterMode,f.eac.autoDungeonChestMode,f.eac.autoDungeonLootTier];};
 f.nav.start({...settings,mode:'zoneShiny'});f.nav.explore();
 assert.deepEqual(seen,[true,true,0]);assert.equal(f.eac.autoDungeonEncounterMode,false);assert.equal(f.eac.autoDungeonChestMode,false);assert.equal(f.eac.autoDungeonLootTier,3);
 f.eac.autoDungeon=()=>{throw new Error('path failed');};const error=f.w.console.error;f.w.console.error=()=>{};
 try{f.nav.explore();}finally{f.w.console.error=error;}
 assert.equal(f.nav.active,false);assert.equal(f.eac.autoDungeonEncounterMode,false);assert.equal(f.eac.autoDungeonLootTier,3);
});
test('zone traversal cannot enter a dungeon from town outside the budgeted planner',()=>{
 const f=setup();f.game.party.alreadyCaughtPokemonByName=()=>false;f.w.MapHelper.moveToTown('Forest');let calls=0;f.eac.autoDungeon=()=>calls++;
 f.nav.start({...settings,mode:'zoneCapture'});f.w.DungeonRunner.dungeonWon();f.nav.explore();assert.equal(calls,0);
});
test('new mode settings survive reload without starting any automatic activity',()=>{
 for(const mode of ['achievement','league','zoneCapture','zoneShiny']){
  const f=setup({autoNavigationSettings:{...settings,mode}});
  assert.equal(f.nav.active,false);assert.equal(f.eac.autoClickState(),false);assert.equal(f.eac.autoGymState(),false);assert.equal(f.eac.autoDungeonState(),false);
  assert.equal(f.w.document.getElementById('navigation-mode').value,mode);
 }
});
test('shiny search no-progress limit still applies when route defeats continue',()=>{
 const f=setup();f.game.party.alreadyCaughtPokemonByName=()=>false;f.w.MapHelper.moveToRoute(1,0);assert.equal(f.nav.start({...settings,mode:'zoneShiny',target:10000}),true);
 f.stats.routeKills[0][1](400);f.nav.lastProgressAt=Date.now()-121000;f.nav.tick(true);assert.equal(f.nav.active,false);
});

function twoRegions(f) {
 const docks={kanto:true,johto:false};
 f.w.GameConstants.DockTowns=['Vermilion City','Olivine City'];
 f.towns['Vermilion City']={...f.towns.Home,name:'Vermilion City',isUnlocked:()=>docks.kanto};
 f.towns['Olivine City']={...f.towns.Home,name:'Olivine City',region:1,isUnlocked:()=>docks.johto};
 f.towns['New Bark Town']={...f.towns.Home,name:'New Bark Town',region:1};
 f.player.highestRegion=()=>1;
 f.routes.push({number:29,region:1,isUnlocked:()=>true});f.stats.routeKills[1]=[];f.stats.routeKills[1][29]=o(0);
 f.w.MapHelper.moveToTown('New Bark Town');
 return docks;
}
test('native locked current-region dock prevents inter-region plans but leaves local routes usable',()=>{
 const f=setup();twoRegions(f);
 // Native MapHelper.accessToRoute checks the destination only. Ship access is a separate guard.
 assert.equal(f.w.MapHelper.accessToRoute(1,0),true);
 f.nav.start(settings);assert.equal(f.player.region,1);assert.equal(f.player.route,29);
 f.nav.stop();assert.equal(f.player.town.name,'New Bark Town');
 assert.equal(f.nav.move({kind:'town',name:'Home',region:0}),false);assert.equal(f.player.region,1);
});
test('native unlocked departure dock authorizes discovered-region travel and a legal return',()=>{
 const f=setup();const docks=twoRegions(f);docks.johto=true;
 f.nav.start(settings);assert.equal(f.player.region,0);assert.equal(f.player.route,1);
 f.nav.stop();assert.equal(f.player.region,1);assert.equal(f.player.town.name,'New Bark Town');
});
test('return cannot bypass a newly locked departure dock in the destination region',()=>{
 const f=setup();const docks=twoRegions(f);docks.johto=true;
 f.nav.start(settings);docks.kanto=false;f.nav.stop();
 assert.equal(f.player.region,0);assert.equal(f.player.route,1);assert.match(f.nav.message,/Original location no longer accessible/);
});
test('missing departure dock data fails closed only for travel to another region',()=>{
 const f=setup();twoRegions(f);delete f.w.GameConstants.DockTowns;
 assert.equal(f.nav.move({kind:'route',number:1,region:0}),false);
 assert.equal(f.nav.move({kind:'route',number:29,region:1}),true);
});

test('external objectives share ownership, budgets and ephemeral preferences',()=>{
 const f=setup();const a=f.w.PokeAutomationAdapters.adapters.navigation;
 const owner={active:true,isCurrent(){return this.active;},onManual(){this.active=false;a.release(this,'Manual travel');}};
 const saved=f.w.localStorage.getItem('autoNavigationSettings');
 assert.equal(a.acquire(owner),true);assert.equal(a.acquire(owner),true);
 assert.equal(a.acquire({active:true,isCurrent:()=>true}),false);
 assert.equal(a.apply(owner,{target:{kind:'route',number:1,region:0},count:2}),true);
 assert.equal(f.player.route,1);assert.equal(f.w.localStorage.getItem('autoNavigationSettings'),saved);
 f.stats.routeKills[0][1](2);f.nav.tick(true);assert.equal(a.inspect().status,'done');assert.equal(f.nav.active,true);
 const spent=f.nav.spent;assert.equal(a.apply(owner,{target:{kind:'route',number:3,region:0},count:1}),true);assert.equal(f.nav.spent,spent);
 f.w.MapHelper.moveToRoute(1,0);assert.equal(owner.active,false);assert.equal(f.nav.active,false);assert.equal(f.player.route,1);
 assert.equal(a.apply(owner,{target:{kind:'route',number:3,region:0},count:1}),false);
});
test('external pending objective never moves during capture',()=>{
 const f=setup();const a=f.w.PokeAutomationAdapters.adapters.navigation;const owner={active:true,isCurrent:()=>true,onManual(){}};
 a.acquire(owner);f.w.Battle.catching=()=>true;
 a.apply(owner,{target:{kind:'route',number:3,region:0},count:1});assert.equal(f.player.route,0);assert.equal(a.inspect().status,'waiting');
 f.w.Battle.catching=()=>false;f.nav.tick(true);assert.equal(f.player.route,3);
});
test('external release restores only settings still owned and rejects expired sessions',()=>{
 const f=setup();const a=f.w.PokeAutomationAdapters.adapters.navigation;const owner={active:true,isCurrent(){return this.active;},onManual(){}};
 f.eac.autoClickState(true);a.acquire(owner);a.apply(owner,{target:{kind:'route',number:1,region:0},count:2});
 f.eac.autoClickState(false);owner.active=false;f.nav.tick(true);
 assert.equal(f.eac.autoClickState(),false);assert.equal(f.nav.active,false);assert.equal(f.w.PokeAutomationAdapters.movementOwner,null);
});
test('clicker exports a load independent adapter and manual control invalidates its token',()=>{
 const f=setup();const fs=require('node:fs');const source=fs.readFileSync(require('node:path').join(__dirname,'../enhancedautoclicker.user.js'),'utf8');
 const method=source.match(/static registerAutomationAdapter\(\) \{([\s\S]*?)\n    \}/);
 assert.ok(method);f.run('EnhancedAutoClicker.registerAutomationAdapter=function(){'+method[1]+'};EnhancedAutoClicker.registerAutomationAdapter()');
 const a=f.w.PokeAutomationAdapters.adapters.clicker;let canceled=false;const owner={active:true,isCurrent(){return this.active;},onManual(){canceled=true;this.active=false;a.release(this,'manual');}};
 assert.equal(a.acquire(owner),true);assert.equal(a.apply(owner,{enabled:true}),true);assert.equal(f.eac.autoClickState(),true);
 f.eac.toggleAutoClick();assert.equal(canceled,true);assert.equal(f.eac.autoClickState(),false);
});
test('runner and navigation preserve shared registry in either initialization order and reload OFF',()=>{
 const fs=require('node:fs'),path=require('node:path');const source=fs.readFileSync(path.join(__dirname,'../autoquestrunner.user.js'),'utf8');
 const f=setup();const registry=f.w.PokeAutomationAdapters;
 f.run(source);f.run('AutoQuestRunner.init()');assert.equal(f.w.PokeAutomationAdapters,registry);
 const r=f.w.AutoQuestRunner;assert.equal(r.start(),true);assert.equal(r.apply('navigation',{target:{kind:'route',number:1,region:0},count:1}),true);r.stop();
 const g=setup();delete g.w.PokeAutomationAdapters;g.run(source);g.run('AutoQuestRunner.init()');const early=g.w.PokeAutomationAdapters;
 g.nav.registerAdapter();assert.equal(g.w.PokeAutomationAdapters,early);assert.equal(g.w.AutoQuestRunner.active,false);
});
function installNativeClickerControls(f) {
 const fs=require('node:fs'),path=require('node:path');const source=fs.readFileSync(path.join(__dirname,'../enhancedautoclicker.user.js'),'utf8');
 for(const name of ['toggleAutoClick','toggleAutoGym','toggleAutoDungeon','registerAutomationAdapter']) {
  const match=source.match(new RegExp('static '+name+'\\(([^)]*)\\) \\{([\\s\\S]*?)\\n    \\}'));
  assert.ok(match,name);f.run('EnhancedAutoClicker.'+name+'=function('+match[1]+'){'+match[2]+'}');
 }
 for(const id of ['auto-click-start','auto-gym-start','auto-dungeon-start']) {const button=f.w.document.createElement('button');button.id=id;f.w.document.body.append(button);}
 f.eac.toggleAutoClickerLoop=()=>{};f.eac.canStartAutoGym=()=>true;f.eac.canStartAutoDungeon=()=>true;
 f.eac.registerAutomationAdapter();return f.w.PokeAutomationAdapters.adapters.clicker;
}
function tokenFor(...adapters) {return {active:true,isCurrent(){return this.active;},onManual(reason){this.active=false;for(const a of adapters)a.release(this,reason);}};}
test('manual travel invalidates idle acquired navigation and failed first objectives',()=>{
 for(const invalid of [false,true]) {const f=setup(),a=f.w.PokeAutomationAdapters.adapters.navigation,owner=tokenFor(a);a.acquire(owner);
  if(invalid)assert.equal(a.apply(owner,{target:{kind:'route',number:2,region:0},count:1}),false);
  f.w.MapHelper.moveToRoute(3,0);assert.equal(owner.active,false);assert.equal(f.w.PokeAutomationAdapters.movementOwner,null);
  assert.equal(a.apply(owner,{target:{kind:'route',number:1,region:0},count:1}),false);assert.equal(f.player.route,3);
 }
});
test('clicker and movement reservations are symmetric and include standalone navigation',()=>{
 const f=setup(),clicker=installNativeClickerControls(f),nav=f.w.PokeAutomationAdapters.adapters.navigation;
 const a=tokenFor(clicker),b=tokenFor(nav);assert.equal(clicker.acquire(a),true);assert.equal(nav.acquire(b),false);assert.equal(f.nav.start(settings),false);
 clicker.release(a);assert.equal(nav.acquire(b),true);assert.equal(clicker.acquire(a),false);assert.equal(clicker.acquire(b),true);
 nav.release(b,'Stopped');assert.equal(nav.acquire(a),false);clicker.release(b);assert.equal(f.nav.start(settings),true);
 assert.equal(clicker.acquire(a),false);f.nav.stop();assert.equal(clicker.acquire(a),true);clicker.release(a);
});
test('native clicker disable preserves and conditionally restores gym and dungeon cascades',()=>{
 for(const mode of ['Gym','Dungeon']) {const f=setup(),a=installNativeClickerControls(f),owner=tokenFor(a);
  f.eac['toggleAuto'+mode]();assert.equal(f.eac.autoClickState(),true);assert.equal(f.eac['auto'+mode+'State'](),true);
  const stored=['autoClickState','autoGymState','autoDungeonState'].map(key=>f.w.localStorage.getItem(key));
  assert.equal(a.acquire(owner),true);assert.equal(a.apply(owner,{enabled:false}),true);
  assert.equal(f.eac['auto'+mode+'State'](),false);assert.deepEqual(['autoClickState','autoGymState','autoDungeonState'].map(key=>f.w.localStorage.getItem(key)),stored);
  a.release(owner);assert.equal(f.eac.autoClickState(),true);assert.equal(f.eac['auto'+mode+'State'](),true);
  assert.deepEqual(['autoClickState','autoGymState','autoDungeonState'].map(key=>f.w.localStorage.getItem(key)),stored);
 }
});
test('manual native spending control during temporary disable retains user choice',()=>{
 const f=setup(),a=installNativeClickerControls(f),owner=tokenFor(a);f.eac.toggleAutoGym();a.acquire(owner);a.apply(owner,{enabled:false});
 f.eac.toggleAutoDungeon();assert.equal(owner.active,false);assert.equal(f.eac.autoDungeonState(),true);assert.equal(f.eac.autoGymState(),false);
 assert.equal(f.w.localStorage.getItem('autoDungeonState'),'true');
});
test('native navigation Start cancels its owning runner before shared-resource checks',()=>{
 for(const names of [['navigation'],['navigation','clicker'],['clicker','navigation']]) {
  const f=setup();installNativeClickerControls(f);
  const fs=require('node:fs'),path=require('node:path');f.run(fs.readFileSync(path.join(__dirname,'../autoquestrunner.user.js'),'utf8'));f.run('AutoQuestRunner.init()');
  const runner=f.w.AutoQuestRunner;assert.equal(runner.start(names),true);const owner=runner.owner;
  assert.equal(runner.apply('navigation',{target:{kind:'route',number:3,region:0},count:2}),true);
  assert.equal(f.nav.start(settings),true);assert.equal(runner.active,false);assert.equal(owner.isCurrent(),false);
  assert.equal(f.nav.active,true);assert.equal(f.nav.externalOwner,null);assert.equal(f.w.PokeAutomationAdapters.movementOwner,null);
  assert.equal(f.w.PokeAutomationAdapters.clickerOwner,f.nav);assert.equal(f.player.route,1);
 }
});
test('autonomous runner uses real navigation across native route claims and next list',()=>{
 const f=setup(),fs=require('node:fs'),path=require('node:path');let claims=0,begins=0;
 const make=()=>({constructor:{name:'DefeatPokemonsQuest'},amount:1,route:1,region:0,pointsReward:10,initial:o(null),focus:f.stats.routeKills[0][1],claimed:o(false)});let list=[make()];
 Object.assign(f.game.quests,{questList:()=>list,questSlots:()=>1,canStartNewQuest:()=>!list.some(q=>q.initial()!=null&&!q.claimed()),beginQuest(i){begins++;list[i].initial(list[i].focus());},claimQuest(i){claims++;assert.equal(list[i].focus()-list[i].initial(),1);list[i].claimed(true);list=[make()];}});
 f.run(fs.readFileSync(path.join(__dirname,'../autoquestrunner.user.js'),'utf8'));f.run('AutoQuestRunner.init()');const runner=f.w.AutoQuestRunner;
 assert.equal(runner.start(),true);assert.equal(f.player.route,1);assert.equal(begins,1);
 f.nav.deadline=Date.now()-1;f.stats.routeKills[0][1](1);f.nav.tick(true);runner.tick();runner.tick();
 assert.equal(claims,1);assert.equal(begins,2);assert.equal(runner.active,true);assert.equal(f.nav.active,true);
 f.stats.routeKills[0][1](2);f.nav.tick(true);runner.tick();assert.equal(claims,2);
 f.w.MapHelper.moveToRoute(3,0);assert.equal(runner.active,false);runner.tick();assert.equal(claims,2);
});
test('owned town transit waits for capture, suspends objective and resumes same native session',()=>{
 const f=setup(),a=f.w.PokeAutomationAdapters.adapters.navigation,owner=tokenFor(a);a.acquire(owner);
 a.apply(owner,{target:{kind:'route',number:1,region:0},count:1,session:settings});const spent=f.nav.spent;
 f.w.Battle.catching=()=>true;assert.equal(a.travel(owner,{kind:'town',name:'Home',region:0}),false);assert.equal(f.player.route,1);
 f.w.Battle.catching=()=>false;assert.equal(a.travel(owner,{kind:'town',name:'Home',region:0}),true);assert.equal(f.player.route,0);f.nav.tick(true);assert.equal(f.player.town.name,'Home');assert.equal(f.nav.externalObjective,null);
 assert.equal(a.apply(owner,{target:{kind:'route',number:3,region:0},count:1}),true);assert.equal(f.player.route,3);assert.equal(f.nav.spent,spent);
 owner.active=false;assert.equal(a.travel(owner,{kind:'town',name:'Home',region:0}),false);assert.equal(f.player.route,3);
});
test('runner uses real owned native transit purchase and route resume without standalone shop loop',()=>{
 const fs=require('node:fs'),path=require('node:path'),f=setup();f.run(fs.readFileSync(path.join(__dirname,'../autoquestrunner.user.js'),'utf8'));f.run('AutoQuestRunner.init()');const r=f.w.AutoQuestRunner;
 const ball={quantity:o(0)};f.game.pokeballs.pokeballs=[ball];const item={name:'Pokeball',type:0,currency:0,isAvailable:()=>true,isSoldOut:()=>false,totalPrice:n=>n*10,buy:n=>{ball.quantity(ball.quantity()+n);f.game.wallet.currencies[0](f.game.wallet.currencies[0]()-n*10);}};
 f.towns.Home.content=[{parent:f.towns.Home,items:[item],isUnlocked:()=>true}];
 const activity={id:'route:0:1',target:{kind:'route',number:1,region:0},unlocked:true,capabilities:['ball'],rates:{ball:1}};
 const s={epoch:1,quests:[{id:'q',type:'UsePokeballQuest',target:{pokeball:0},remaining:2,known:true,active:true}],resources:{money:100,balls:[0]},activities:[activity],rates:{},commitments:{}};
 f.w.MapHelper.moveToRoute(3,0);assert.equal(r.start(),true);r.executePlan(s,{primary:activity,reasons:[]});assert.equal(f.player.route,0);assert.equal(ball.quantity(),0);r.executePlan(s,{primary:activity,reasons:[]});assert.equal(ball.quantity(),2);s.resources.balls[0]=2;r.executePlan(s,{primary:activity,reasons:[]});assert.equal(f.player.route,1);assert.equal(f.nav.settings.mode,'routes');assert.equal(f.game.wallet.currencies[0](),80);r.stop();
});
test('owned Frontier suspension clears pending movement and survives native Frontier state until resumed',()=>{
 const f=setup(),a=f.w.PokeAutomationAdapters.adapters.navigation;
 const t={active:true,isCurrent(){return this.active;},onManual(){this.active=false;a.release(this,'Manual');}};
 assert.equal(a.acquire(t),true);assert.equal(a.apply(t,{target:{kind:'route',number:1,region:0},count:1}),true);
 assert.equal(a.suspend(t),true);f.game.gameState=f.state.battleFrontier;f.nav.tick(true);assert.equal(t.active,true);assert.equal(f.nav.pendingExternal,null);
 f.game.gameState=f.state.town;assert.equal(a.apply(t,{target:{kind:'route',number:3,region:0},count:1}),true);assert.equal(f.player.route,3);
 t.active=false;a.release(t);assert.equal(a.suspend(t),false);
});

test('external Shadow encounter traversal is scoped to its owned objective and restores preferences', () => {
 const f = setup();
 const adapter = f.w.PokeAutomationAdapters.adapters.navigation;
 const owner = {active:true,isCurrent(){return this.active;},onManual(){this.active=false;adapter.release(this);}};
 assert.equal(adapter.acquire(owner), true);
 f.eac.autoDungeonLootTier = 3;
 let seen;
 f.eac.autoDungeon = () => {seen = [f.eac.autoDungeonEncounterMode,f.eac.autoDungeonChestMode,f.eac.autoDungeonLootTier];};
 adapter.apply(owner, {target:{kind:'dungeon',name:'Forest',region:0},count:1,encounters:true,session:settings});
 f.nav.explore();
 assert.deepEqual(seen, [true,false,3]);
 assert.equal(f.eac.autoDungeonEncounterMode, false);
 assert.equal(f.w.localStorage.getItem('autoDungeonEncounterMode'), null);
 f.nav.externalObjective.encounters = false;
 f.nav.explore();
 assert.deepEqual(seen, [false,false,3]);
 f.nav.externalObjective.encounters = true;
 f.eac.autoDungeon = () => {throw new Error('path failed');};
 const error = f.w.console.error;
 f.w.console.error = () => {};
 try {f.nav.explore();} finally {f.w.console.error = error;}
 assert.equal(owner.active, false);
 assert.equal(f.eac.autoDungeonEncounterMode, false);
});
