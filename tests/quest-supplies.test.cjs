const test=require('node:test');
const assert=require('node:assert/strict');
const {load,observable:o}=require('./helpers.cjs');
function fixture(){
 const f=load('autoquestrunner.user.js','',{Preload:{hideSplashScreen(){}}});f.run('AutoQuestRunner.init()');const r=f.w.AutoQuestRunner,w=f.w;
 w.GameConstants={Pokeball:{None:-1},Currency:{money:0,dungeonToken:1}};
 w.player={region:0,route:1,town:null,highestRegion:()=>0};w.MapHelper={accessToTown:()=>true};
 const balls=[0,0,0,99].map(n=>({quantity:o(n),catchTime:1000}));
 w.App.game.pokeballs={pokeballs:balls,calculatePokeballToUse:()=>3,getCatchBonus:b=>b*10,calculateCatchTime:()=>1000};
 w.App.game.party={calculatePokemonAttack:()=>100,calculateClickAttack:()=>0};w.PokemonFactory={routeHealth:()=>100,routeMoney:()=>20,routeDungeonTokens:()=>10,catchRateHelper:()=>100};
 w.App.game.wallet={currencies:[o(100000),o(0)]};w.PokemonHelper={getPokemonById:id=>({id,name:'Pidgey',type1:0,type2:-1})};
 const town={name:'Mart',region:0,isUnlocked:()=>true};const item={name:'Pokeball',type:0,currency:0,isAvailable:()=>true,isSoldOut:()=>false,totalPrice:n=>n*n*10,buy(n){const price=this.totalPrice(n);if(price>w.App.game.wallet.currencies[0]())return;w.App.game.wallet.currencies[0](w.App.game.wallet.currencies[0]()-price);balls[0].quantity(balls[0].quantity()+n);}};
 const shop={parent:town,items:[item],isUnlocked:()=>true};town.content=[shop];w.TownList={Mart:town};
 r.active=true;r.owner={active:true,isCurrent:()=>r.active,onManual:()=>r.stop('Manual')};r.acquired=[];
 const activity={id:'route:0:1',target:{kind:'route',region:0,number:1},unlocked:true,encounters:[{name:'Pidgey',type:[0],catchRate:100}],rates:{capture:1},capabilities:['capture','money','tokens','ball']};
 const q={id:'1:0',type:'CapturePokemonsQuest',remaining:250,reward:100,target:{},known:true,active:true};
 const snapshot={epoch:1,quests:[q],resources:{money:100000,dungeonToken:0,balls:[0,0,0,99]},activities:[activity],rates:{},commitments:{}};
 return {f,w,r,item,shop,town,balls,activity,q,snapshot};
}
test('supply lots use native geometric quotes, remaining need and standard balls only',()=>{
 const {r,snapshot,activity,item}=fixture();let p=r.planSupplies(snapshot,activity);assert.equal(p.ball,0);assert.equal(p.purchase.quantity,100);assert.equal(p.purchase.quote,item.totalPrice(100));
 snapshot.quests[0].remaining=3;snapshot.quests[0].type='UsePokeballQuest';snapshot.quests[0].target={pokeball:0};p=r.planSupplies(snapshot,activity);assert.equal(p.purchase.quantity,3);
 snapshot.quests[0].type='UsePokeballQuest';snapshot.quests[0].target={pokeball:3};p=r.planSupplies(snapshot,activity);assert.match(p.reason,/standard|Master/i);assert.equal(p.purchase,undefined);
});
test('purchases require native shop presence, fresh quotes wallet inventory and actual deltas',()=>{
 const {r,w,snapshot,activity,balls,item,town}=fixture();const p=r.planSupplies(snapshot,activity).purchase;
 assert.equal(r.executePurchase(p).status,'travel');assert.equal(balls[0].quantity(),0);
 w.player.route=0;w.player.town=town;item.totalPrice=()=>200000;assert.equal(r.executePurchase(p).status,'replan');assert.equal(balls[0].quantity(),0);
 item.totalPrice=n=>n*n*10;w.App.game.wallet.currencies[0](1);assert.equal(r.executePurchase(p).status,'replan');
 w.App.game.wallet.currencies[0](100000);balls[0].quantity(1);assert.equal(r.executePurchase(p).status,'replan');balls[0].quantity(0);
 item.buy=()=>{};assert.equal(r.executePurchase(p).status,'blocked');
 item.buy=n=>{balls[0].quantity(n);w.App.game.wallet.currencies[0](0);};assert.equal(r.executePurchase(p).status,'bought');assert.equal(r.spend.money,100000);
 assert.equal(r.executePurchase(p).status,'replan');
});
test('capture override is scoped, exact standard ball, no rare ball, restored on stop',()=>{
 const {r,w,balls}=fixture();balls[1].quantity(2);const old=w.App.game.pokeballs.calculatePokeballToUse;
 assert.equal(r.applyCapturePolicy({ball:1,type:0}),true);assert.equal(w.App.game.pokeballs.calculatePokeballToUse(1,false,false,0),1);
 balls[1].quantity(0);assert.equal(w.App.game.pokeballs.calculatePokeballToUse(1,false,false,0),-1);
 assert.equal(r.applyCapturePolicy({ball:3}),false);r.stop();assert.equal(w.App.game.pokeballs.calculatePokeballToUse,old);
});
test('Oak equipment uses native available slots and restores only unchanged ownership',()=>{
 const {r,w}=fixture();const active=new Set([2]);w.OakItemType={Magic_Ball:0,Amulet_Coin:1,Exp_Share:3};w.App.game.oakItems={itemList:[0,1,2,3],isUnlocked:i=>i!==1,isActive:i=>active.has(i),maxActiveCount:()=>1,deactivate:i=>active.delete(i),activate:i=>active.add(i)};
 assert.equal(r.equipOak([0]),true);assert.deepEqual([...active],[0]);assert.equal(r.equipOak([1]),false);r.stop();assert.deepEqual([...active],[2]);
 const a=fixture();a.w.App.game.oakItems=w.App.game.oakItems;a.r.equipOak([0]);active.clear();active.add(3);a.r.stop();assert.deepEqual([...active],[3]);
});
test('native route prior lets productive unmeasured route beat measured inferior route',()=>{
 const {r,w}=fixture();w.App.game.party={calculatePokemonAttack:()=>100,calculateClickAttack:()=>0};w.PokemonFactory={routeHealth:n=>n===1?10000:100,routeMoney:n=>n===1?5:100,routeDungeonTokens:()=>10,catchRateHelper:()=>50};
 const a={id:'slow',target:{kind:'route',number:1,region:0},encounters:[{name:'P',type:[0],catchRate:100}],capabilities:['money'],unlocked:true,rates:{money:0.1}};const b={...a,id:'fast',target:{kind:'route',number:2,region:0},rates:{}};
 const s={epoch:1,quests:[{id:'q',type:'GainMoneyQuest',remaining:100,reward:100,target:{},known:true}],activities:[a,b],resources:{},rates:{},commitments:{},previous:a};const plan=r.selectPlan(s,r.buildCandidates(s));assert.equal(plan.primary.id,'fast');assert.equal(plan.primary.estimateSource,'native prior');
});
test('acceptance ranks actionable accessible quest above blocked first entry',()=>{
 const {r,snapshot,activity}=fixture();snapshot.quests=[{id:'blocked',type:'HarvestBerriesQuest',target:{berryType:2},known:true,remaining:10,reward:100},{...snapshot.quests[0],id:'ready',active:false}];activity.rates={capture:1};assert.equal(r.acceptanceOrder(snapshot)[0].id,'ready');
});
test('insufficient funds chooses profitable route recovery and finite no-progress block',()=>{
 const {r,snapshot,activity}=fixture();activity.rates.money=20;snapshot.resources.money=0;const p=r.planSupplies(snapshot,activity);assert.equal(p.recovery.resource,'money');assert.equal(p.recovery.activity.id,activity.id);
 const recovery=p.recovery;assert.equal(r.trackRecovery(snapshot,recovery,0),true);assert.equal(r.trackRecovery(snapshot,recovery,121000),false);assert.match(r.reason,/progress/);
});
test('existing stock goes straight to useful work without repeated shopping',()=>{
 const {r,snapshot,activity,balls}=fixture();balls[0].quantity(1);snapshot.resources.balls[0]=1;snapshot.resources.money=0;
 const supply=r.planSupplies(snapshot,activity);assert.equal(supply.ready,true);assert.equal(supply.purchase,undefined);assert.equal(supply.recovery,undefined);
 let applies=0;r.acquired=[{name:'navigation',adapter:{inspect:()=>({status:'ready'}),apply:()=>{applies++;return true;},release(){}}}];r.executePlan(snapshot,{primary:activity,reasons:[]});assert.equal(applies,1);assert.equal(r.capturePolicy.ball,0);
});
test('runtime travels buys then resumes capture and finite failed purchase blocks repeat spending',()=>{
 const {r,w,snapshot,activity,town,balls}=fixture();let travels=0,applies=0;
 r.acquired=[{name:'navigation',adapter:{inspect:()=>({status:'ready'}),travel:(owner,target)=>{travels++;w.player.route=0;w.player.town=town;return true;},apply:()=>{applies++;return true;},release(){}}}];
 r.executePlan(snapshot,{primary:activity,reasons:[]});assert.equal(travels,1);assert.equal(applies,0);
 r.executePlan(snapshot,{primary:activity,reasons:[]});assert.equal(balls[0].quantity(),100);snapshot.resources.balls[0]=100;snapshot.resources.money=0;
 r.executePlan(snapshot,{primary:activity,reasons:[]});assert.equal(applies,1);assert.equal(travels,1);
});
test('required token entry recovers by captures when dungeon cannot yet be selected',()=>{
 const {r,snapshot,activity}=fixture();activity.rates.tokens=10;snapshot.resources.balls[0]=1;snapshot.resources.money=0;
 const dungeon={id:'d',target:{kind:'dungeon',name:'D'},unlocked:true,rates:{dungeon:1},capabilities:['dungeon'],requirements:[{resource:'dungeonToken',amount:50}]};snapshot.activities.push(dungeon);snapshot.quests=[{id:'dquest',type:'DefeatDungeonQuest',target:{kind:'dungeon',name:'D'},remaining:1,reward:100,known:true,active:true}];
 let target;r.acquired=[{name:'navigation',adapter:{inspect:()=>({status:'ready'}),apply:(owner,o)=>{target=o.target;return true;},release(){}}}];r.executePlan(snapshot,{primary:null,reasons:['tokens needed']});assert.equal(target.kind,'route');assert.equal(r.capturePolicy.ball,0);assert.match(r.reason,/token/i);
});
test('prepared ball and Oak candidates still request exact capture policy and supplies',()=>{
 const {r,w,snapshot,activity,item}=fixture();item.type=1;item.name='Greatball';snapshot.quests[0].type='UsePokeballQuest';snapshot.quests[0].target={pokeball:1};
 const prepared={...activity,pokeball:1,oakItems:[0]};let supply=r.planSupplies(snapshot,prepared);assert.equal(supply.ball,1);assert.equal(supply.capture.ball,1);
 w.OakItemType={Magic_Ball:0};snapshot.quests[0].type='UseOakItemQuest';snapshot.quests[0].target={item:0};supply=r.planSupplies(snapshot,prepared);assert.ok(supply.purchase);assert.equal(supply.capture.ball,1);
});
test('capture filter adapter temporarily precedes saved filters including late load and expires cleanly',()=>{
 const fs=require('node:fs'),{r,w,f,balls}=fixture();balls[0].quantity(2);r.applyCapturePolicy({ball:0});
 w.pokemonList=[{id:1}];w.GameConstants.Pokeball.None=-1;
 f.run(fs.readFileSync(require('node:path').join(__dirname,'../catchfilterfantasia.user.js'),'utf8').split('// Repair only')[0]);
 f.run('filterState=true;filterTypes=[];filterBallPref=[{normal:5,shiny:5}];catchFilter=[];overloadPokeballMethod();');
 assert.equal(w.PokeAutomationAdapters.adapters.capture.version,1);assert.equal(w.App.game.pokeballs.calculatePokeballToUse(1,false,false,0),0);r.stop();assert.equal(w.App.game.pokeballs.calculatePokeballToUse(1,false,false,0),-1);
});
test('token purchases are bounded by native token yield and unknown capture costs are explained',()=>{
 const {r,w,snapshot,activity}=fixture();w.App.game.party={calculatePokemonAttack:()=>100,calculateClickAttack:()=>0};w.PokemonFactory={routeHealth:()=>100,routeMoney:()=>100,routeDungeonTokens:()=>100,catchRateHelper:()=>53};
 snapshot.quests[0].type='GainTokensQuest';snapshot.quests[0].remaining=100;const p=r.planSupplies(snapshot,activity);assert.equal(p.purchase.quantity,2);
 delete w.PokemonFactory;const unknown=r.planSupplies(snapshot,activity);assert.equal(unknown.purchase,undefined);assert.match(unknown.reason,/probability|estimate/i);
});
test('native purchase exceeding fresh quote records spend and blocks further automatic buying',()=>{
 const {r,w,snapshot,activity,item,town,balls}=fixture();const p=r.planSupplies(snapshot,activity).purchase;w.player.route=0;w.player.town=town;w.App.game.wallet.currencies[0](200000);
 item.buy=n=>{balls[0].quantity(n);w.App.game.wallet.currencies[0](99999);};const result=r.executePurchase(p);assert.equal(result.status,'blocked');assert.equal(r.spend.money,100001);
});
test('runtime token recovery retains stall clock across useful navigation scheduling',()=>{
 const {r,snapshot,activity}=fixture();snapshot.resources.balls[0]=1;activity.rates.tokens=10;
 snapshot.activities.push({id:'d',target:{kind:'dungeon',name:'D'},unlocked:true,rates:{dungeon:1},capabilities:['dungeon'],requirements:[{resource:'dungeonToken',amount:50}]});snapshot.quests=[{id:'dq',type:'DefeatDungeonQuest',target:{kind:'dungeon',name:'D'},remaining:1,reward:100,known:true,active:true}];
 r.acquired=[{name:'navigation',adapter:{inspect:()=>({status:'ready'}),apply:()=>true,release(){}}}];r.executePlan(snapshot,{primary:null,reasons:[]});assert.ok(r.recoveryState);r.recoveryState.time-=121000;r.executePlan(snapshot,{primary:null,reasons:[]});assert.match(r.reason,/no progress/);
});
test('policy observations do not mix money recovery delay into capture rates',()=>{
 const {r,snapshot,activity,q}=fixture();q.native={};q.remaining=10;
 r.observedRates={};r.rateSamples={};r.currentPlan={primary:{...activity,recoveryResource:'money',capturePolicy:{ball:-1}}};r.observation={epoch:1,time:Date.now()-1000,activity:activity.id,quests:[{...q,remaining:10}]};r.observeProgress(snapshot);assert.equal(Object.keys(r.rateSamples?.[activity.id] || {}).length,0);
});
test('bounded native ball choices prefer faster owned stock and account for quoted recovery cost',()=>{
 const {r,w,snapshot,activity,item,shop}=fixture();snapshot.resources.balls=[1,1,0];w.App.game.pokeballs.getCatchBonus=b=>b===1?60:0;w.PokemonFactory.catchRateHelper=()=>43;
 let prepared=r.prepareActivity(activity,snapshot);assert.equal(prepared.pokeball,1);
 snapshot.resources.balls=[0,0,0];const great={...item,type:1,name:'Greatball',totalPrice:()=>100000};shop.items.push(great);prepared=r.prepareActivity(activity,snapshot);assert.equal(prepared.pokeball,0);
});
test('native claimed or completed ball and Oak quests yield policy slots to unfinished quests',()=>{
 for(const claimed of [true,false]) {
  const {r,w,activity}=fixture();
  const native=(type,target,done)=>({constructor:{name:type},amount:10,pointsReward:100,initial:o(0),focus:o(done?10:0),claimed:o(done&&claimed),...target});
  w.App.game.quests={questList:()=>[native('UsePokeballQuest',{pokeball:0},true),native('UsePokeballQuest',{pokeball:1},false)]};
  let snapshot=r.readQuestSnapshot({activities:[activity]});let prepared=r.prepareActivity(activity,snapshot);assert.equal(prepared.pokeball,1);assert.equal(r.buildCandidates(snapshot)[0].questIds[0],snapshot.quests[1].id);
  w.OakItemType={Magic_Ball:0,Amulet_Coin:1,Exp_Share:3};w.App.game.oakItems={isUnlocked:()=>true,maxActiveCount:()=>1};
  w.App.game.quests.questList=()=>[native('UseOakItemQuest',{item:0},true),native('UseOakItemQuest',{item:3},false)];
  snapshot=r.readQuestSnapshot({activities:[activity]});prepared=r.prepareActivity(activity,snapshot);assert.deepEqual([...prepared.oakItems],[3]);assert.equal(r.buildCandidates(snapshot)[0].questIds[0],snapshot.quests[1].id);
 }
});
test('mixed capture money defeat gems and non-wild Oak progress cannot inflate ball lot',()=>{
 const {r,w,snapshot,activity,q}=fixture();q.remaining=1;w.OakItemType={Magic_Ball:0,Amulet_Coin:1,Exp_Share:3};
 for(const type of ['GainMoneyQuest','DefeatPokemonsQuest','GainGemsQuest','UseOakItemQuest']) {
  const target=type==='DefeatPokemonsQuest'?activity.target:type==='GainGemsQuest'?{type:0}:{item:3};
  snapshot.quests.push({id:type,type,target,remaining:100000,reward:100,known:true,active:true});
 }
 const supply=r.planSupplies(snapshot,activity);assert.equal(supply.purchase.quantity,2);
});
test('nested zero-ball zero-money token recovery keeps independent leaf stall clock',()=>{
 const {r,snapshot,activity}=fixture();snapshot.resources.money=0;snapshot.resources.balls[0]=0;
 snapshot.activities.push({id:'d',target:{kind:'dungeon',name:'D'},unlocked:true,rates:{dungeon:1},capabilities:['dungeon'],requirements:[{resource:'dungeonToken',amount:50}]});snapshot.quests=[{id:'dq',type:'DefeatDungeonQuest',target:{kind:'dungeon',name:'D'},remaining:1,reward:100,known:true,active:true}];
 let applies=0;r.acquired=[{name:'navigation',adapter:{inspect:()=>({status:'ready'}),apply:()=>{applies++;return true;},release(){}}}];
 r.executePlan(snapshot,{primary:null,reasons:[]});assert.equal(applies,1);assert.match(r.recoveryState.key,/money/);r.recoveryState.time-=121000;
 r.executePlan(snapshot,{primary:null,reasons:[]});assert.equal(applies,1);assert.match(r.reason,/no progress/);
});
test('real leaf money progress keeps parent token preparation productive',()=>{
 const {r,snapshot,activity}=fixture();snapshot.resources.money=0;
 const tokens={resource:'dungeonToken',activity},money={resource:'money',activity};
 assert.equal(r.trackRecovery(snapshot,tokens,0),true);assert.equal(r.trackRecovery(snapshot,money,0),true);
 snapshot.resources.money=1;assert.equal(r.trackRecovery(snapshot,money,110000),true);assert.equal(r.trackRecovery(snapshot,tokens,130000),true);
});

test('free refresh keeps dungeon work with chained money standard-ball and token recovery',()=>{
 const {r,snapshot:s,activity}=fixture();s.quests=[{id:'d',type:'DefeatDungeonQuest',known:true,active:true,claimed:false,target:{kind:'dungeon',name:'Cave'},remaining:1,reward:100}];
 s.resources.money=0;s.activities.push({id:'cave',target:{kind:'dungeon',name:'Cave'},unlocked:true,capabilities:['dungeon'],rates:{},requirements:[{resource:'dungeonToken',amount:10}]});
 const tokenRoute=r.recoveryActivity(s,'dungeonToken');assert.ok(tokenRoute);
 const supplies=r.planSupplies(s,{...tokenRoute,recoverTokens:true});assert.equal(supplies.ready,false);assert.equal(supplies.recovery.resource,'money');assert.equal(supplies.recovery.activity.id,activity.id);
 assert.equal(r.evaluateRefresh(s,{refreshCost:0}).refresh,false);
 s.activities[1].requirements=[{resource:'money',amount:10}];assert.equal(r.evaluateRefresh(s,{refreshCost:0}).refresh,false);
});

test('estimate provenance follows contributing metrics rather than unrelated observations',()=>{
 const {r,snapshot,activity}=fixture();
 snapshot.quests[0].type='GainMoneyQuest';
 activity.rates={capture:1};
 const candidate=r.buildCandidates(snapshot)[0];
 assert.equal(candidate.estimateSource,'native prior');
 activity.rates.money=2;
 assert.equal(r.buildCandidates(snapshot)[0].estimateSource,'observed');
});

test('an unmeasured random objective remains unknown despite unrelated observations',()=>{
 const {r,snapshot,activity}=fixture();
 snapshot.quests[0].type='CatchShiniesQuest';
 activity.capabilities.push('shiny');
 activity.rates={money:2};
 assert.equal(r.buildCandidates(snapshot)[0].estimateSource,'unknown');
});
