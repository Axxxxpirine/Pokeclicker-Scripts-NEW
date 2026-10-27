const test=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('./helpers.cjs');
function setup(storage={}) {
 let calls=0, money=100;
 const list=[];
 const quests={questList:Object.assign(()=>list,{indexOf:q=>list.indexOf(q)}),incompleteQuests:()=>list,currentQuests:()=>[],claimQuest(){},beginQuest(){},generateQuestList(){},canStartNewQuest:()=>false,canAffordRefresh:()=>true,freeRefresh:()=>false,getRefreshCost:()=>({amount:30}),refreshQuests(){calls++;money-=30;}};
 const c=load('custom/autoquestcompleter.user.js','<div id="questDisplayContainer"></div><div id="settingsModal"><div></div><ul class="nav-tabs"></ul><div class="tab-content"></div></div>',{App:{isUsingClient:true,game:{quests,wallet:{currencies:[()=>money]}}},QuestHelper:{quests:{A:{},B:{}}},GameConstants:{MINUTE:60000,Currency:{money:0},camelCaseToString:s=>s},Preload:{hideSplashScreen(){}}},storage);
 c.run('initAutoQuest()');return {...c,quests,get calls(){return calls;},get money(){return money;}};
}
test('enabling quests does not immediately refresh the list',()=>{
 const f=setup();f.w.document.getElementById('toggle-auto-quest').click();assert.equal(f.calls,0);
});
test('reset timer cannot spend by default, and OFF clears its callback',()=>{
 const f=setup({autoQuestEnabled:true,autoQuestResetState:true});f.tick();assert.equal(f.calls,0);
 f.w.document.getElementById('toggle-auto-quest').click();assert.equal(f.timers.size,0);
});
test('paid refresh obeys per-session budget and money reserve',()=>{
 const f=setup({autoQuestEnabled:true,autoQuestResetState:true,autoQuestRefreshBudget:30,autoQuestMoneyReserve:60});
 f.tick();assert.equal(f.calls,1);f.tick();assert.equal(f.calls,1);assert.equal(f.money,70);
});
test('loaded reset option cannot refresh when quest automation is OFF',()=>{
 const f=setup({autoQuestEnabled:false,autoQuestResetState:true,autoQuestRefreshBudget:300});f.tick();assert.equal(f.calls,0);
 f.w.document.getElementById('select-autoQuestMaxQuests').value='1';f.w.document.getElementById('select-autoQuestMaxQuests').dispatchEvent(new f.w.Event('change'));assert.equal(f.calls,0);
});
test('quest lease suspends stale reset callbacks and resumes unchanged enabled settings',()=>{
 const f=setup({autoQuestEnabled:true,autoQuestResetState:true,autoQuestRefreshBudget:300,autoQuestMaxQuests:3});const old=[...f.timers.values()][0];
 const owner={active:true,isCurrent:()=>owner.active,onManual:()=>{owner.active=false;adapter.release(owner);}};const adapter=f.w.PokeAutomationAdapters.adapters.quests;
 assert.equal(adapter.inspect().slots,3);assert.equal(adapter.acquire(owner),true);assert.equal(f.timers.size,0);old();assert.equal(f.calls,0);assert.equal(f.timers.size,0);
 owner.active=false;adapter.release(owner);assert.equal(f.timers.size,1);f.tick();assert.equal(f.calls,1);
});
test('manual legacy OFF commits before lease release and cannot claim accept or refresh',()=>{
 const f=setup({autoQuestEnabled:true,autoQuestResetState:true,autoQuestRefreshBudget:300});const adapter=f.w.PokeAutomationAdapters.adapters.quests;let claims=0,begins=0;
 const owner={active:true,isCurrent:()=>owner.active,onManual(){owner.active=false;adapter.release(owner);}};adapter.acquire(owner);
 f.quests.claimQuest=()=>claims++;f.quests.beginQuest=()=>begins++;
 const done=()=>true;done.subscribe=()=>({dispose(){}});const pending=()=>false;pending.subscribe=()=>({dispose(){}});
 f.quests.questList().push({isCompleted:done,claimed:()=>false,inProgress:()=>true,constructor:{name:'A'}},{isCompleted:pending,claimed:()=>false,inProgress:()=>false,constructor:{name:'A'}});
 f.w.document.getElementById('toggle-auto-quest').click();f.tick();assert.equal(owner.active,false);assert.equal(claims,0);assert.equal(begins,0);assert.equal(f.calls,0);
});

function startRunner(f) {
 const fs = require('node:fs');
 f.run(fs.readFileSync(require('node:path').join(__dirname, '../autoquestrunner.user.js'), 'utf8'));
 f.run('AutoQuestRunner.init()');
 const r = f.w.AutoQuestRunner;
 f.w.PokeAutomationAdapters.adapters.navigation = {
  acquire: () => true, inspect: () => ({status:'ready'}), apply: () => true, release() {},
 };
 assert.equal(r.start(), true);
 return r;
}

test('enabled legacy initializer hands off before any claim acceptance or reset schedule', () => {
 const f = setup();
 delete f.w.PokeAutomationAdapters.adapters.quests;
 const r = startRunner(f);
 f.w.localStorage.setItem('autoQuestEnabled', 'true');
 f.w.localStorage.setItem('autoQuestResetState', 'true');
 let claims = 0;
 f.quests.claimQuest = () => claims++;
 f.quests.questList().push({constructor:{name:'GainMoneyQuest'},amount:1,pointsReward:1,
  initial:()=>0, focus:()=>1, claimed:()=>false, isCompleted:()=>true,inProgress:()=>true});
 f.run('initAutoQuest()');
 assert.equal(claims, 0, 'initialization cannot claim before coordinator reconciliation');
 assert.equal(r.acquired.filter(e=>e.name==='quests').length, 1);
 assert.equal(f.timers.size, 1, 'only runner interval remains');
 r.tick();
 assert.equal(claims, 1, 'runner performs the native claim after handoff');
});

test('scheduled legacy callback cannot race late registration and tick acquires before actions', () => {
 const f = setup({autoQuestEnabled:true,autoQuestResetState:true,autoQuestRefreshBudget:300});
 const callback = [...f.timers.values()][0];
 const adapter = f.w.PokeAutomationAdapters.adapters.quests;
 delete f.w.PokeAutomationAdapters.adapters.quests;
 const r = startRunner(f);
 f.w.PokeAutomationAdapters.adapters.quests = adapter;
 callback();
 assert.equal(f.calls, 0, 'old callback yields even before the next runner tick');
 r.tick();
 assert.equal(r.acquired.find(e=>e.name==='quests')?.adapter, adapter);
 assert.equal(f.timers.size, 1);
 r.stop();
 assert.equal(f.timers.size, 1, 'legacy enabled timer resumes');
});

test('late busy quests adapter stops runner before native actions', () => {
 const f = setup();
 delete f.w.PokeAutomationAdapters.adapters.quests;
 const r = startRunner(f);
 let nativeActions = 0;
 f.quests.canStartNewQuest = () => { nativeActions++; return false; };
 f.w.PokeAutomationAdapters.adapters.quests = {acquire:()=>false,inspect:()=>({slots:10})};
 r.tick();
 assert.equal(r.active, false);
 assert.match(r.reason, /another session/);
 assert.equal(nativeActions, 0);
});
