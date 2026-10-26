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
