const test=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('./helpers.cjs');
function setup(){ const f=load('autoquestrunner.user.js','<div class="battle-view"></div>',{Preload:{hideSplashScreen(){}}}); f.run('AutoQuestRunner.init()'); return f; }
test('runner initializes OFF and rejects unavailable adapters without gameplay',()=>{const f=setup();const r=f.w.AutoQuestRunner;assert.equal(r.version,1);assert.equal(r.active,false);assert.equal(r.start(['navigation']),false);assert.equal(r.active,false);});
test('registry survives either order and session invalidates on manual control',()=>{const f=setup();let releases=0;f.w.PokeAutomationAdapters.adapters.navigation={inspect:()=>({status:'ready'}),acquire:()=>true,apply:()=>true,release:()=>releases++};const r=f.w.AutoQuestRunner;assert.equal(r.start(['navigation']),true);const token=r.owner;assert.equal(r.start(['navigation']),false);assert.equal(token.isCurrent(),true);token.onManual('travel');assert.equal(token.active,false);assert.equal(token.isCurrent(),false);assert.equal(releases,1);assert.equal(r.apply('navigation',{}),false);r.init();assert.equal(r.active,false);});
test('failed shared resource acquisition releases earlier module and invalidates callback',()=>{
 const f=setup(),r=f.w.AutoQuestRunner;let token,release=0;
 f.w.PokeAutomationAdapters.adapters.clicker={inspect:()=>({status:'ready'}),acquire:o=>(token=o,true),apply:()=>true,release:o=>{assert.equal(o.active,false);release++;}};
 f.w.PokeAutomationAdapters.adapters.navigation={inspect:()=>({status:'blocked'}),acquire:()=>false,apply:()=>false,release:()=>assert.fail('unacquired release')};
 assert.equal(r.start(['clicker','navigation']),false);assert.equal(release,1);assert.equal(token.isCurrent(),false);assert.equal(r.active,false);
});
test('manual cancellation releases all shared leases before returning control',()=>{
 const f=setup(),r=f.w.AutoQuestRunner,registry=f.w.PokeAutomationAdapters;
 for(const name of ['navigation','clicker'])registry.adapters[name]={inspect:()=>({status:'ready'}),acquire:owner=>(registry[name]=owner,true),apply:()=>true,release:owner=>{assert.equal(owner.isCurrent(),false);registry[name]=null;}};
 assert.equal(r.start(['navigation','clicker']),true);const owner=r.owner;owner.onManual('Manual navigation control');
 assert.equal(r.active,false);assert.equal(registry.navigation,null);assert.equal(registry.clicker,null);assert.equal(r.apply('navigation',{}),false);
});
function quest(type, fields={}) {return {constructor:{name:type},amount:100,pointsReward:100,initial:()=>1000,focus:()=>1090,claimed:()=>false,...fields};}
test('snapshot uses focus minus initial, object-scoped epochs and all native targets',()=>{
 const f=setup(),r=f.w.AutoQuestRunner,q=quest('DefeatPokemonsQuest',{route:1,region:0});f.w.App.game.quests={questList:()=>[q]};
 const a=r.readQuestSnapshot();assert.equal(a.quests[0].remaining,10);assert.equal(a.quests[0].target.number,1);assert.equal(r.readQuestSnapshot().epoch,a.epoch);
 f.w.App.game.quests.questList=()=>[quest('AlienQuest')];const b=r.readQuestSnapshot();assert.notEqual(a.epoch,b.epoch);assert.match(b.quests[0].reason,/Unknown/);
});
function snapshot(quests,activities){return {epoch:1,quests,activities,resources:{},commitments:{},rates:{},previous:null};}
function normalized(id,type,remaining=10,target={}){return {id,type,remaining,target,reward:100,claimed:false,known:true};}
test('planner rewards shared route, excludes locked paths, and stays stable',()=>{
 const f=setup(),r=f.w.AutoQuestRunner,s=snapshot([normalized('a','DefeatPokemonsQuest',10,{kind:'route',number:1,region:0}),normalized('b','CapturePokemonsQuest')],[{id:'route:0:1',target:{kind:'route',number:1,region:0},unlocked:true,rates:{defeat:1,capture:1}},{id:'route:0:2',target:{kind:'route',number:2,region:0},unlocked:true,rates:{capture:1.5}},{id:'locked',target:{kind:'route',number:1,region:0},unlocked:false,rates:{defeat:100,capture:100}}]);
 const c=r.buildCandidates(s),p=r.selectPlan(s,c);assert.equal(p.primary.id,'route:0:1');assert.equal(c.some(x=>x.id==='locked'),false);assert.equal(r.selectPlan(s,c).primary.id,p.primary.id);
});
test('missing estimates and absent paths are explicit finite planning outcomes',()=>{
 const r=setup().w.AutoQuestRunner,s=snapshot([normalized('x','MineItemsQuest')],[{id:'mine',module:'mine',target:{kind:'mine'},unlocked:true,rates:{}}]);const p=r.selectPlan(s,r.buildCandidates(s));assert.equal(p.primary,null);assert.match(p.reasons.join(' '),/estimate|path/);assert.equal(JSON.stringify(p).includes('null'),true);
});
test('all eighteen classes map to executable activity metrics and prerequisites',()=>{
 const r=setup().w.AutoQuestRunner;assert.equal(Object.keys(r.questMetrics).length,18);
 for(const [type,metric] of Object.entries(r.questMetrics)){
 const target=type==='DefeatGymQuest'?{kind:'gym',name:'Pewter'}:type==='DefeatDungeonQuest'?{kind:'dungeon',name:'Forest'}:type==='DefeatPokemonsQuest'?{kind:'route',number:1,region:0}:{type:2,berryType:3,pokeball:0,item:1};
 const activity={id:type,target:target.kind?target:{kind:'route'},unlocked:true,module:['farm','hatchery','mine'].includes(metric)?metric:undefined,rates:{[metric]:1},types:[2],berryType:3,pokeball:0,oakItems:[1],requirements:[{resource:'money',amount:20}]};
 const s=snapshot([normalized('q',type,10,target)],[activity]);const c=r.buildCandidates(s);assert.equal(c.length,1,type);assert.equal(c[0].questIds.length,1,type);assert.equal(c[0].prerequisites[0].resource,'money',type);
 }
});
test('completion wakes replanning, hysteresis holds near ties, and resources include recovery time',()=>{
 const r=setup().w.AutoQuestRunner,s=snapshot([normalized('q','CapturePokemonsQuest')],[{id:'a',target:{kind:'route'},unlocked:true,rates:{capture:1}},{id:'b',target:{kind:'route'},unlocked:true,rates:{capture:1.1}}]);
 s.previous={id:'a',epoch:1};let p=r.selectPlan(s,r.buildCandidates(s));assert.equal(p.primary.id,'a');
 s.quests.push(normalized('done','HatchEggsQuest',0));p=r.selectPlan(s,r.buildCandidates(s));assert.equal(p.primary.id,'b');assert.equal(p.replan,true);assert.deepEqual([...p.claimable],['done']);
 s.activities[1].requirements=[{resource:'money',amount:100}];s.rates.money=10;const c=r.buildCandidates(s).find(c=>c.id==='b');assert.ok(c.seconds>19);assert.equal(c.prerequisites[0].missing,100);
});
test('background farm commitments wait without replacement and incompatible actions do not add scores',()=>{
 const r=setup().w.AutoQuestRunner,s=snapshot([normalized('q','HarvestBerriesQuest',10,{berryType:3})],[{id:'farm:new',module:'farm',target:{kind:'farm'},berryType:3,unlocked:true,rates:{berries:1}}]);
 s.commitments.farm='farm:occupied';const c=r.buildCandidates(s),p=r.selectPlan(s,c);assert.equal(c[0].seconds,null);assert.equal(p.background.length,0);assert.match(p.reasons.join(' '),/recovery/);
});
test('native snapshot normalizes all eighteen classes and independent count targets',()=>{
 const f=setup(),r=f.w.AutoQuestRunner;
 const list=Object.keys(r.questMetrics).map(type=>quest(type,{type:4,berryType:5,item:1,pokeball:2,gymTown:'Pewter',dungeon:'Forest',route:2,region:0}));
 f.w.App.game.quests={questList:()=>list};const s=r.readQuestSnapshot();assert.equal(s.quests.length,18);
 for(const q of s.quests){assert.equal(q.remaining,10,q.type);assert.equal(q.known,true,q.type);}
 assert.equal(s.quests.find(q=>q.type==='DefeatGymQuest').target.gym,'Pewter');
 assert.equal(s.quests.find(q=>q.type==='HarvestBerriesQuest').target.berryType,5);
});
test('cold start explores native currently available route encounters and accessible background work',()=>{
 const f=setup(),r=f.w.AutoQuestRunner;f.w.Routes={regionRoutes:[{number:1,region:0,isUnlocked:()=>true,pokemon:{land:['Locked']}}]};f.w.RouteHelper={getAvailablePokemonList:()=>['Available']};f.w.pokemonMap={Available:{type:[2]},Locked:{type:[3]}};
 f.w.App.game.quests={questList:()=>[quest('CapturePokemonTypesQuest',{type:2}),quest('HatchEggsQuest')]};f.w.App.game.breeding={canAccess:()=>true};
 const s=r.readQuestSnapshot(),p=r.selectPlan(s,r.buildCandidates(s));assert.equal(p.primary.id,'route:0:1');assert.equal(p.primary.exploratory,true);assert.equal(p.primary.score,0);assert.equal(p.background[0].module,'hatchery');assert.deepEqual([...s.activities[0].types],[2]);
});
function nativeLocations(f){const town={name:'Shared Town',region:0,isUnlocked:()=>true};f.w.TownList={'Shared Town':town};f.w.GymList={'Special Gym':{parent:town,isUnlocked:()=>true}};const dungeon={name:'Shared Town',tokenCost:30,baseTokenCost:1,isUnlocked:()=>true,hasUnlockedBoss:()=>true};town.dungeon=dungeon;f.w.dungeonList={'Shared Town':dungeon};f.w.DungeonGuides={hired:()=>false};return {town,dungeon};}
test('native location cold start uses gym key plus parent town and dungeon capabilities',()=>{
 const f=setup(),r=f.w.AutoQuestRunner;nativeLocations(f);f.w.App.game.quests={questList:()=>[quest('DefeatGymQuest',{gymTown:'Special Gym'})]};let s=r.readQuestSnapshot(),p=r.selectPlan(s,r.buildCandidates(s));assert.equal(p.primary.target.name,'Shared Town');assert.equal(p.primary.target.gym,'Special Gym');
 f.w.App.game.quests.questList=()=>[quest('DefeatDungeonQuest',{dungeon:'Shared Town'})];s=r.readQuestSnapshot();s.resources.dungeonToken=1000;p=r.selectPlan(s,r.buildCandidates(s));assert.equal(p.primary.target.kind,'dungeon');assert.equal(p.primary.exploratory,true);
});
test('native destination unlock bosses guides and departure gate activities',()=>{
 const f=setup(),r=f.w.AutoQuestRunner,{town,dungeon}=nativeLocations(f);f.w.App.game.quests={questList:()=>[quest('DefeatGymQuest',{gymTown:'Special Gym'}),quest('DefeatDungeonQuest',{dungeon:'Shared Town'})]};
 f.w.GymList['Special Gym'].isUnlocked=()=>false;dungeon.isUnlocked=()=>false;let s=r.readQuestSnapshot();assert.equal(r.buildCandidates(s).length,0);
 dungeon.isUnlocked=()=>true;dungeon.hasUnlockedBoss=()=>false;s=r.readQuestSnapshot();assert.equal(r.buildCandidates(s).length,0);
 dungeon.hasUnlockedBoss=()=>true;f.w.DungeonGuides.hired=()=>true;s=r.readQuestSnapshot();const waiting=r.buildCandidates(s);assert.equal(waiting[0].prerequisites.some(p=>p.resource==='guide'),true);assert.equal(r.selectPlan(s,waiting).primary,null);
 f.w.DungeonGuides.hired=()=>false;town.region=1;f.w.player={region:0,highestRegion:()=>1};f.w.GameConstants={DockTowns:['Dock']};s=r.readQuestSnapshot();assert.equal(r.buildCandidates(s).length,0);assert.match(r.selectPlan(s,[]).reasons.join(' '),/departure|dock/i);
});
test('dungeon total recovery prices actual tokenCost for remaining clears separately from entry',()=>{
 const f=setup(),r=f.w.AutoQuestRunner;nativeLocations(f);f.w.App.game.quests={questList:()=>[quest('DefeatDungeonQuest',{dungeon:'Shared Town',amount:3,initial:()=>0,focus:()=>0})]};let s=r.readQuestSnapshot({rates:{'dungeon:Shared Town':{dungeon:1},dungeonToken:10}});s.resources.dungeonToken=30;const c=r.buildCandidates(s)[0];assert.equal(c.requirements[0].amount,30);assert.equal(c.entryPrerequisites.length,0);assert.equal(c.prerequisites[0].amount,90);assert.equal(c.prerequisites[0].missing,60);assert.equal(c.seconds,9);
});
test('dungeon bootstrap can observe one funded entry without estimating future token recovery',()=>{
 const f=setup(),r=f.w.AutoQuestRunner;nativeLocations(f);f.w.App.game.quests={questList:()=>[quest('DefeatDungeonQuest',{dungeon:'Shared Town',amount:3,initial:()=>0,focus:()=>0})]};
 let s=r.readQuestSnapshot();s.resources.dungeonToken=30;let c=r.buildCandidates(s),p=r.selectPlan(s,c);assert.equal(p.primary.id,'dungeon:Shared Town');assert.equal(p.primary.seconds,null);assert.equal(p.primary.prerequisites[0].missing,60);assert.equal(p.primary.entryPrerequisites.length,0);
 s.resources.dungeonToken=29;p=r.selectPlan(s,r.buildCandidates(s));assert.equal(p.primary,null);
 f.w.DungeonGuides.hired=()=>true;s=r.readQuestSnapshot();s.resources.dungeonToken=30;p=r.selectPlan(s,r.buildCandidates(s));assert.equal(p.primary,null);
});

function loopFixture(kind='route',deferred=false){
 const f=setup(),r=f.w.AutoQuestRunner;let value=0,list,accepted=0,claimed=0,applies=0,state='ready';const notifications=[];
 const obs=initial=>{let v=initial;const listeners=new Set();const o=(...args)=>{if(!args.length)return v;v=args[0];for(const cb of listeners)deferred?notifications.push(()=>cb(v)):cb(v);};o.subscribe=cb=>(listeners.add(cb),{dispose:()=>listeners.delete(cb)});return o;};
 const make=()=>quest(kind==='route'?'DefeatPokemonsQuest':kind==='gym'?'DefeatGymQuest':'DefeatDungeonQuest',{amount:1,route:1,region:0,gymTown:'Special Gym',dungeon:'Shared Town',initial:obs(null),focus:()=>value,claimed:obs(false)});
 list=obs([make()]);nativeLocations(f);f.w.Routes={regionRoutes:[{number:1,region:0,isUnlocked:()=>true}]};f.w.RouteHelper={getAvailablePokemonList:()=>[]};f.w.App.game.wallet={currencies:[()=>1000,()=>1000]};
 f.w.App.game.quests={questList:list,questSlots:()=>1,canStartNewQuest:()=>!list().some(q=>q.initial()!=null&&!q.claimed()),beginQuest:i=>{accepted++;list()[i].initial(value);},claimQuest:i=>{const q=list()[i];assert.equal(value-q.initial(),1);assert.equal(q.claimed(),false);claimed++;q.claimed(true);list([make()]);}};
 f.w.PokeAutomationAdapters.adapters.navigation={acquire:()=>true,release:()=>{},inspect:()=>({status:state}),apply:(owner,objective)=>{assert.equal(list()[0].initial()!=null,true);assert.equal(objective.count,1);assert.ok(objective.session.tokenBudget>0);applies++;state='running';return true;}};
 return {f,r,complete(){value++;state='done';f.tick();},flush(){while(notifications.length)notifications.shift()();},counts:()=>({accepted,claimed,applies}),replace(){list([make()]);}};
}
for(const kind of ['route','gym','dungeon'])test(`autonomous ${kind} accepts works claims and starts native next list`,()=>{
 const t=loopFixture(kind,true);assert.equal(t.r.start(),true);assert.equal(t.counts().accepted,1);assert.equal(t.counts().applies,1);t.complete();t.flush();t.f.tick();assert.equal(t.counts().claimed,1);assert.equal(t.counts().accepted,2);assert.equal(t.counts().applies,2);t.r.stop();t.complete();assert.equal(t.counts().claimed,1);
});
test('manual list replacement discards old identity and measured rates',()=>{const t=loopFixture();t.r.start();t.replace();t.f.tick();assert.equal(t.counts().accepted,2);assert.equal(t.counts().claimed,0);t.r.stop();});
test('runtime measures useful target progress and drops samples when list identity changes',()=>{
 const t=loopFixture();let now=1000;t.f.w.Date.now=()=>now;t.r.start();now+=1000;t.complete();const rates=t.r.observedRates['route:0:1'];assert.equal(Object.values(rates)[0],1);
 t.f.tick();assert.equal(Object.keys(t.r.observedRates).length,0);t.r.stop();
});
