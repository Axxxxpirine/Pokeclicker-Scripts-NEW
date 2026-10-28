const test = require('node:test');
const assert = require('node:assert/strict');
const {load, observable:o} = require('./helpers.cjs');

function fixture() {
    const h=load('autoquestrunner.user.js','',{Preload:{hideSplashScreen(){}}});
    h.run('AutoQuestRunner.init()');
    const r=h.w.AutoQuestRunner;
    const q=(id,type,remaining,target={})=>({id,type,remaining,target,native:{},known:true,active:true,reward:100,claimed:false});
    const quests=[q('gems','GainGemsQuest',374,{type:0}),q('balls','UsePokeballQuest',332,{pokeball:1}),
        q('shiny','CatchShiniesQuest',1),q('items','MineItemsQuest',13),q('tokens','GainTokensQuest',5464),
        q('route','DefeatPokemonsQuest',367,{kind:'route',number:2,region:0}),
        q('capture','CapturePokemonsQuest',137),q('farm','GainFarmPointsQuest',3706)];
    const route=n=>({id:`route:0:${n}`,target:{kind:'route',number:n,region:0},unlocked:true,types:[0],
        capabilities:['defeat','capture','tokens','gems','shiny'],rates:{defeat:5,capture:.5,ball:.5,tokens:10,gems:2}});
    const gym={id:'gym:Viridian City',target:{kind:'gym',name:'Viridian City'},unlocked:true,capabilities:['gym'],rates:{'capture:{}':1}};
    const backgrounds=[['farm','farmPoints'],['mine','items'],['hatchery','capture']].map(([module,metric])=>({
        id:module,module,target:{kind:module},unlocked:true,capabilities:[metric],rates:{[metric]:1}}));
    const s={epoch:1,quests,activities:[gym,route(1),route(2),...backgrounds],resources:{money:70000000,balls:[139,5000,0]},rates:{},commitments:{}};
    h.w.App.game.statistics={totalPokemonDefeated:o(100),totalPokemonHatched:o(10)};
    h.w.PokemonFactory={routeDungeonTokens:()=>10};
    return {...h,r,s,gym,route,q};
}

test('hatch progress cannot turn an unrelated gym into a capture destination',()=>{
    const {r,s,gym,w,dom}=fixture();
    r.observedRates={};r.rateSamples={};r.currentPlan={primary:gym};
    r.observation={epoch:1,time:Date.now()-1000,activity:gym.id,quests:s.quests.map(q=>({...q,remaining:q.remaining+(q.id==='capture'?1:0)}))};
    r.observeProgress(s);
    assert.equal(r.observedRates[gym.id]?.['capture:{}'],undefined);
    assert.equal(r.buildCandidates(s).some(c=>c.id===gym.id),false,'stale contaminated rates must also be rejected');
    dom.window.close();
});

test('mixed shiny list chooses route synergy while farm mine and hatchery run concurrently',()=>{
    const {r,s,dom}=fixture();
    const candidates=r.buildCandidates(s), plan=r.selectPlan(s,candidates);
    assert.equal(plan.primary.id,'route:0:2');
    assert.deepEqual([...plan.background.map(c=>c.module)].sort(),['farm','hatchery','mine']);
    assert.equal(plan.primary.pokeball,1);
    assert.equal(plan.primary.seconds,null,'shiny completion time must stay unknown');
    assert.equal(plan.primary.score,0,'do not promise a full-list reward rate');
    s.quests.find(q=>q.id==='route').claimed=true;
    Object.assign(s.activities[1].rates,{capture:2,ball:2,tokens:40});
    const next=r.selectPlan({...s,previous:plan.primary},r.buildCandidates(s));
    assert.equal(next.primary.id,'route:0:1','replan after a quest completes');
    assert.equal(next.background.length,3);
    dom.window.close();
});

test('an uncertain shiny cannot hide known route work behind a slow real gym quest',()=>{
    const {r,s,gym,q,dom}=fixture();
    s.quests.push(q('gym','DefeatGymQuest',100,{kind:'gym',gym:'Viridian City'}));
    gym.target.gym='Viridian City';gym.rates={gym:.01};
    assert.equal(r.selectPlan(s,r.buildCandidates(s)).primary.id,'route:0:2');
    dom.window.close();
});

test('route capture measurements are not inflated by concurrent hatchery progress',()=>{
    const {r,s,route,dom}=fixture(), primary=route(2);
    r.observedRates={};r.rateSamples={};r.currentPlan={primary,background:[{module:'hatchery'}]};
    r.observation={epoch:1,time:Date.now()-1000,activity:primary.id,quests:s.quests.map(q=>({...q,remaining:q.remaining+(q.id==='capture'?1:0)}))};
    r.observeProgress(s);
    assert.equal(r.observedRates[primary.id]?.['capture:{}'],undefined);
    dom.window.close();
});

for (const expensive of [false,true]) test(`mixed route cannot starve feasible gym with ${expensive?'expensive':'unavailable'} balls`,()=>{
    const {r,s,gym,q,w,dom}=fixture();
    s.quests=[q('route','DefeatPokemonsQuest',10,{kind:'route',number:2,region:0}),q('shiny','CatchShiniesQuest',1),q('gym','DefeatGymQuest',10,{kind:'gym',gym:'Viridian City'})];
    gym.target.gym='Viridian City';gym.rates={gym:1};
    s.resources={money:0,balls:[0,0,0]};s.rates.money=1;
    if(expensive){
        const town={name:'Mart',region:0,isUnlocked:()=>true};
        town.content=[{parent:town,isUnlocked:()=>true,items:[{name:'Pokeball',type:0,currency:0,isAvailable:()=>true,isSoldOut:()=>false,totalPrice:n=>n*1000000}]}];
        w.TownList={Mart:town};w.player={region:0,highestRegion:()=>0};w.MapHelper={accessToTown:()=>true};
    }
    assert.equal(r.selectPlan(s,r.buildCandidates(s)).primary.id,gym.id);
    dom.window.close();
});

test('mixed supply estimates cover faster observed combat than native priors',()=>{
    const {r,s,gym,q,w,dom}=fixture();
    s.quests=[q('route','DefeatPokemonsQuest',100,{kind:'route',number:2,region:0}),q('shiny','CatchShiniesQuest',1),q('gym','DefeatGymQuest',100,{kind:'gym',gym:'Viridian City'})];
    gym.target.gym='Viridian City';gym.rates={gym:1};
    Object.assign(s.activities[2],{encounters:[{name:'Pidgey',type:[0],catchRate:100}],rates:{defeat:10,'ball:{"pokeball":0}':10}});
    s.resources={money:0,balls:[1,0,0]};
    w.App.game.party={calculatePokemonAttack:()=>12,calculateClickAttack:()=>0};
    Object.assign(w.PokemonFactory,{routeHealth:()=>100,catchRateHelper:()=>100});
    assert.equal(r.selectPlan(s,r.buildCandidates(s)).primary.id,gym.id);
    dom.window.close();
});
