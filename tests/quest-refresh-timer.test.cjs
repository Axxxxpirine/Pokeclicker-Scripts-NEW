const test = require('node:test');
const assert = require('node:assert/strict');
const {load,observable:o,Currency} = require('./helpers.cjs');

function fixture({stored,free=false,cost=100,money=1000,deferred=false}={}) {
    const h=load('autoquestrunner.user.js','<section id="questDisplayContainer"></section>',
        {Preload:{hideSplashScreen(){}}},stored ? {autoQuestRunnerRefreshTimer:stored} : {});
    let now=1000, pending, work=0;
    h.w.Date.now=()=>now;
    const make=()=>({constructor:{name:'MineItemsQuest'},amount:100,pointsReward:100,initial:o(0),focus:o(0),claimed:o(false)});
    const list=o([make()]), wallet=o(money), calls=[];
    const native={questList:list,questSlots:()=>1,canStartNewQuest:()=>false,freeRefresh:o(free),
        getRefreshCost:()=>({amount:cost,currency:Currency.money}),canAffordRefresh:()=>wallet()>=cost,
        refreshQuests(isFree,confirm){
            calls.push({isFree,confirm});
            const finish=()=>{if(!isFree)wallet(wallet()-cost);this.freeRefresh(false);list([make()]);};
            if(deferred)return new Promise(resolve=>{pending=()=>{finish();resolve();};});
            finish();
        }};
    h.w.App.game.quests=native;
    h.w.App.game.wallet={currencies:[wallet,o(0),o(0)]};
    h.run('AutoQuestRunner.init()');
    const r=h.w.AutoQuestRunner;
    h.w.PokeAutomationAdapters.adapters.navigation={acquire:()=>true,release(){},inspect:()=>({status:'ready'})};
    h.w.PokeAutomationAdapters.adapters.mine={acquire:()=>true,release(){},apply(){work++;},
        inspect:()=>({status:'waiting',activities:[{id:'mine',module:'mine',target:{kind:'mine'},unlocked:true,capabilities:['items'],rates:{items:1}}]})};
    return {...h,r,native,list,wallet,calls,make,work:()=>work,finish:()=>pending(),advance(ms){now+=ms;r.tick();},
        close(){r.stop();h.dom.window.close();}};
}

test('timer controls save the interval and enabled state, reject invalid minutes, and reload without starting AutoQuest',()=>{
    const h=fixture(),doc=h.w.document;
    const toggle=doc.getElementById('auto-quest-refresh-enabled'),minutes=doc.getElementById('auto-quest-refresh-minutes');
    assert.ok(toggle,'AutoQuest needs its own reset timer control');
    assert.equal(toggle.checked,false);assert.equal(minutes.value,'10');
    minutes.value='3';minutes.dispatchEvent(new h.w.Event('change'));
    toggle.click();
    assert.equal(h.r.refreshTimerEnabled,true);assert.equal(h.r.refreshTimerMinutes,3);
    for(const invalid of ['0','-1','1.5','1441','']){
        minutes.value=invalid;minutes.dispatchEvent(new h.w.Event('change'));
        assert.equal(minutes.value,'3');
    }
    const stored=JSON.parse(h.w.localStorage.getItem('autoQuestRunnerRefreshTimer'));
    const reloaded=fixture({stored});
    assert.equal(reloaded.r.refreshTimerEnabled,true);assert.equal(reloaded.r.refreshTimerMinutes,3);
    assert.equal(reloaded.r.active,false);assert.match(doc.getElementById('auto-quest-refresh-status').textContent,/paused/i);
    h.close();reloaded.close();
});

test('paid timer refreshes at the chosen interval, including below the economic cooldown, and displays native cost',async()=>{
    const h=fixture();h.r.setRefreshTimer(true,1);h.r.start();
    assert.match(h.w.document.getElementById('auto-quest-refresh-status').textContent,/1:00.*100/);
    h.advance(59999);assert.equal(h.calls.length,0);
    h.advance(1);assert.deepEqual(h.calls,[{isFree:false,confirm:false}]);assert.equal(h.wallet(),900);
    await Promise.resolve();h.r.tick();
    h.advance(59999);assert.equal(h.calls.length,1);
    h.advance(1);assert.equal(h.calls.length,2);assert.equal(h.wallet(),800);
    h.close();
});

test('timer uses native free refresh first and waits for funds before a paid reset',async()=>{
    const h=fixture({free:true,money:50});h.r.setRefreshTimer(true,1);h.r.start();
    h.advance(60000);assert.equal(h.calls[0].isFree,true);assert.equal(h.wallet(),50);
    await Promise.resolve();h.r.tick();h.advance(60000);
    assert.equal(h.calls.length,1);assert.match(h.w.document.getElementById('auto-quest-refresh-status').textContent,/funds/i);
    h.wallet(120);h.advance(250);
    assert.equal(h.calls.length,2);assert.equal(h.calls[1].isFree,false);assert.equal(h.wallet(),20);
    h.close();
});

test('new lists and interval changes restart the countdown while disabling or stopping prevents timed resets',()=>{
    const h=fixture();h.r.setRefreshTimer(true,1);h.r.start();h.advance(50000);
    h.list([h.make()]);h.r.tick();h.advance(10000);assert.equal(h.calls.length,0);
    h.r.setRefreshTimer(true,2);h.advance(60000);assert.equal(h.calls.length,0);
    h.r.setRefreshTimer(false,2);h.advance(300000);assert.equal(h.calls.length,0);
    h.r.setRefreshTimer(true,1);h.r.stop();h.advance(60000);assert.equal(h.calls.length,0);
    h.r.start();h.advance(59999);assert.equal(h.calls.length,0);h.advance(1);assert.equal(h.calls.length,1);
    h.close();
});

test('completed quest is claimed before an expired timer can discard it, and native next list gets a full interval',()=>{
    const h=fixture();let claims=0;
    h.native.claimQuest=()=>{claims++;h.list([h.make()]);};
    h.r.setRefreshTimer(true,1);h.r.start();h.list()[0].focus(100);
    h.advance(60000);assert.equal(claims,1);assert.equal(h.calls.length,0);
    h.r.tick();h.advance(59999);assert.equal(h.calls.length,0);
    h.advance(1);assert.equal(h.calls.length,1);h.close();
});

test('pending native refresh cannot duplicate payment or execute work from the old list',async()=>{
    const h=fixture({deferred:true});h.r.setRefreshTimer(true,1);h.r.start();
    h.advance(60000);const work=h.work();
    assert.equal(h.r.acquired.some(a=>a.name==='mine'),false);
    h.advance(60000);h.advance(60000);
    assert.equal(h.calls.length,1);assert.equal(h.work(),work);
    h.finish();await new Promise(setImmediate);h.r.tick();
    assert.equal(h.wallet(),900);assert.ok(h.work()>work);h.close();
});

test('OFF then ON preserves an outstanding native reset until it settles',async()=>{
    const h=fixture({deferred:true});h.r.setRefreshTimer(true,1);h.r.start();
    h.advance(60000);const work=h.work();h.r.stop();h.r.start();
    assert.equal(h.work(),work,'restart must not resume stale objectives during refresh');
    h.advance(60000);assert.equal(h.calls.length,1);
    h.finish();await new Promise(setImmediate);h.r.tick();
    assert.equal(h.r.refreshPending,false);assert.ok(h.work()>work);
    h.advance(59999);assert.equal(h.calls.length,1);
    h.advance(1);assert.equal(h.calls.length,2);
    h.finish();await new Promise(setImmediate);h.close();
});

test('invalid saved timer settings fall back to disabled and invalid native costs never spend',()=>{
    const h=fixture({stored:{enabled:'true',minutes:-5},cost:NaN});
    assert.equal(h.r.refreshTimerEnabled,false);assert.equal(h.r.refreshTimerMinutes,10);
    h.r.setRefreshTimer(true,1);h.r.start();h.advance(60000);
    assert.equal(h.calls.length,0);assert.equal(h.wallet(),1000);h.close();
});

test('rejected native reset waits another interval instead of retrying every tick',async()=>{
    const h=fixture();let attempts=0;
    h.native.refreshQuests=()=>{attempts++;return Promise.reject(new Error('Unavailable'));};
    h.r.setRefreshTimer(true,1);h.r.start();h.advance(60000);
    await new Promise(setImmediate);
    assert.equal(h.r.refreshPending,false);assert.equal(h.r.active,true);
    h.advance(250);h.advance(59500);assert.equal(attempts,1);
    h.advance(250);assert.equal(attempts,2);assert.equal(h.wallet(),1000);
    await new Promise(setImmediate);h.close();
});
