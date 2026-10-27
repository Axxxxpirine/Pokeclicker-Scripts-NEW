const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {load,observable:o} = require('./helpers.cjs');

for (const desktop of [false,true]) {
    test(`${desktop ? 'desktop' : 'browser'} wrapper earns supplies captures hatches claims next list and restores`, () => {
        const f = load('autoquestrunner.user.js','<div id="questDisplayContainer"></div>',{
            App:{isUsingClient:true,game:{}},Preload:{hideSplashScreen(){}}
        });
        const w = f.w;
        w.App.isUsingClient = desktop;
        w.unsafeWindow = w;
        w.DesktopScriptHandler = {isEpheniaScriptEnabled:()=>true};
        // Run the ordinary loader wrapper with enablement configured before startup.
        f.run(`(function(){${fs.readFileSync(path.join(__dirname,'../autoquestrunner.user.js'),'utf8')}\n})()`);
        w.Preload.hideSplashScreen();
        const r = w.AutoQuestRunner;
        assert.ok(r);
        assert.equal(r.active,false);
        w.GameConstants = {Currency:{money:0,dungeonToken:1,questPoint:2},Pokeball:{None:-1}};
        w.OakItemType = {Magic_Ball:0};
        const wallet = [o(0),o(0),o(0)];
        const balls = [0,0,0,99].map(n=>({quantity:o(n)}));
        const originalCapture = ()=>3;
        const events = [];
        w.App.game.wallet = {currencies:wallet};
        w.App.game.pokeballs = {pokeballs:balls,calculatePokeballToUse:originalCapture,calculateCatchTime:()=>0};
        w.App.game.party = {calculatePokemonAttack:()=>100,calculateClickAttack:()=>0};
        w.PokemonFactory = {routeHealth:()=>100,routeMoney:()=>20,routeDungeonTokens:()=>1,catchRateHelper:()=>100};
        const town = {name:'Mart',region:0,isUnlocked:()=>true};
        w.player = {region:0,route:1,town:null,highestRegion:()=>0};
        w.MapHelper = {accessToTown:()=>true,accessToRoute:()=>true};
        const item = {name:'Pokeball',type:0,currency:0,isAvailable:()=>true,isSoldOut:()=>false,totalPrice:n=>n*10,
            buy(n){events.push('buy');wallet[0](wallet[0]()-this.totalPrice(n));balls[0].quantity(balls[0].quantity()+n);}};
        town.content = [{parent:town,items:[item],isUnlocked:()=>true}];
        w.TownList = {Mart:town};
        let captures = 0, hatches = 0;
        function quest(type,focus) {return {constructor:{name:type},amount:1,pointsReward:10,initial:o(null),focus,claimed:o(false)};}
        const captureQuest = quest('CapturePokemonsQuest',()=>captures);
        const hatchQuest = quest('HatchEggsQuest',()=>hatches);
        let list = [captureQuest,hatchQuest], generation = 0;
        w.App.game.quests = {
            questList:()=>list,questSlots:()=>2,canStartNewQuest:()=>true,calcListBonus:()=>2,
            beginQuest(i){events.push('accept');list[i].initial(list[i].focus());},
            claimQuest(i){events.push('claim');list[i].claimed(true);wallet[2](wallet[2]()+10);
                if(list.every(q=>q.claimed())) {wallet[2](wallet[2]()+2);list=[quest('GainMoneyQuest',()=>0)];generation++;}},
        };
        let navState = 'ready', hatchEnabled = false;
        const registry = w.PokeAutomationAdapters;
        registry.adapters.navigation = {
            acquire:()=>true,inspect:()=>({status:navState}),release(){navState='ready';events.push('release navigation');},
            travel(owner,target){assert.equal(owner.isCurrent(),true);events.push('town');w.player.route=0;w.player.town=town;return true;},
            apply(owner,objective){assert.equal(owner.isCurrent(),true);events.push('route');w.player.route=1;w.player.town=null;navState='running';return true;},
        };
        registry.adapters.hatchery = {
            acquire:()=>true,inspect:()=>({status:'waiting',reason:'Egg steps',activities:[{id:'hatchery',module:'hatchery',target:{kind:'hatchery'},unlocked:true,capabilities:['hatch'],rates:{}}]}),
            apply(){hatchEnabled=true;return true;},release(){hatchEnabled=false;events.push('release hatchery');}
        };
        w.Routes = {regionRoutes:[{number:1,region:0,isUnlocked:()=>true}]};
        w.RouteHelper = {getAvailablePokemonList:()=>['Pidgey']};
        w.pokemonMap = {Pidgey:{name:'Pidgey',type:[0],catchRate:100}};
        assert.equal(r.start(),true);
        assert.equal(wallet[0](),0);
        assert.match(r.reason,/money/i);
        assert.equal(w.App.game.pokeballs.calculatePokeballToUse(1,false,false,0),-1);
        // Native-like battle income funds the coordinator's native shop path.
        wallet[0](40); f.tick(); f.tick(); f.tick();
        assert.ok(events.includes('town'));
        assert.ok(events.includes('buy'));
        assert.equal(w.player.route,1);
        assert.equal(hatchEnabled,true);
        assert.equal(w.App.game.pokeballs.calculatePokeballToUse(1,false,false,0),0);
        balls[0].quantity(balls[0].quantity()-1); captures++; hatches++;
        f.tick(); f.tick(); f.tick();
        assert.equal(captureQuest.claimed(),true);
        assert.equal(hatchQuest.claimed(),true);
        assert.equal(generation,1);
        assert.equal(wallet[2](),22);
        r.stop();
        assert.equal(r.active,false);
        assert.equal(hatchEnabled,false);
        assert.equal(w.App.game.pokeballs.calculatePokeballToUse,originalCapture);
        assert.equal(r.acquired.length,0);
        const claims=events.filter(e=>e==='claim').length;
        f.tick();
        assert.equal(events.filter(e=>e==='claim').length,claims);
    });
}
