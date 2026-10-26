const test = require('node:test');
const assert = require('node:assert/strict');
const {load, observable:o} = require('./helpers.cjs');
function setup() {
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
      MapHelper:{accessToRoute:n=>routes.find(r=>r.number===n)?.isUnlocked(),accessToTown:n=>!!towns[n]?.isUnlocked(),moveToTown:move,moveToRoute(n,r){player.route=n;player.region=r;game.gameState=state.fighting;}},Routes:{regionRoutes:routes},RouteHelper:{getAvailablePokemonList:()=>['A']},TownList:towns,GymList:{},DungeonGuides:{hired:()=>false},
      DungeonRunner:{dungeonID:0,dungeonFinished:o(false),fightingBoss:o(false),defeatedBoss:o(null),canStartDungeon:x=>x.hasUnlockedBoss(),dungeonWon(){if(!this.dungeonFinished()){this.dungeonFinished(true);this.returnToTown();}},dungeonLost(){this.dungeonFinished(true);this.returnToTown();},dungeonLeave(){this.dungeonFinished(true);this.returnToTown();},initializeDungeon(x){this.dungeonID++;this.dungeonFinished(false);game.wallet.currencies[1](game.wallet.currencies[1]()-x.tokenCost);game.gameState=state.dungeon;this.dungeon=x;},returnToTown(){c.w.MapHelper.moveToTown('Forest');},fighting:o(false)},GymRunner:{autoRestart:o(false),startGym(){game.gameState=state.gym;}},Battle:{catching:()=>false},DungeonBattle:{catching:()=>false},Preload:{hideSplashScreen(){}},Shop:class Shop{},ItemList:{},PokemonType:{},pokemonMap:{},Notifier:{notify(){}},NotificationConstants:{NotificationOption:{warning:'warning'}}};
    c=load('autonavigation.user.js','<div class="battle-view"></div>',globals);
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
