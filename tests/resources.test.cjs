const test=require('node:test');
const assert=require('node:assert/strict');
const {load,observable:o}=require('./helpers.cjs');
function setup(){
 const money=o(100),item=o(4),flow=o(0),orb=o(0);let now=0;
 const game={wallet:{currencies:[money],addAmount(a,ignore){assert.equal(ignore,true);money(money()+a.amount);}},purifyChamber:{currentFlow:flow,flowNeeded:()=>1500},dreamOrbController:{orbs:[{color:'Pink',amount:orb}]},farming:{berryInventory:[o(2)]}};
 const c=load('custom/optionalresources.user.js','<div id="saveTab"></div>',{App:{isUsingClient:true,game},GameConstants:{Currency:{money:0,0:'money'}},Amount:class{constructor(amount,currency){Object.assign(this,{amount,currency});}},ItemList:{Red_shard:{name:'Red_shard',gain(n){item(item()+n);}},Key_stone:{name:'Key_stone',gain(n){item(item()+n);}}},UndergroundItems:{list:[{itemName:'Red_shard'}]},player:{itemList:{Red_shard:item,Key_stone:item}},BerryType:{Cheri:0,0:'Cheri'},BagHandler:{gainItem(i,n){game.farming.berryInventory[i.id](game.farming.berryInventory[i.id]()+n);}},ItemType:{berry:2},performance:{now:()=>now},PurifyChamber:{requirements:{isCompleted:()=>true}}});
 c.w.performance.now=()=>now;
 c.run('OptionalResources.init()');return {...c,res:c.run('OptionalResources'),money,item,flow,orb,game,advance(n){now+=n;c.tick();}};
}
test('resource commands start OFF and init is idempotent',()=>{const c=setup();assert.equal(c.res.enabled,false);assert.equal(c.res.grant('currency','0',10),false);assert.equal(c.money(),100);c.res.init();assert.equal(c.w.document.querySelectorAll('#optional-resources').length,1);assert.equal(c.timers.size,0);});
test('validated currency amount bypasses bonuses and updates native wallet once',()=>{const c=setup();c.res.setEnabled(true);assert.equal(c.res.grant('currency','0','20'),true);assert.equal(c.money(),120);});
test('invalid values and IDs cannot mutate resources',()=>{const c=setup();c.res.setEnabled(true);for(const n of ['',null,true,NaN,Infinity,-1,0,1.5,'abc','1e309',1000000001])assert.equal(c.res.grant('currency','0',n),false,String(n));assert.equal(c.res.grant('currency','-1',5),false);assert.equal(c.res.grant('item','toString',5),false);assert.equal(c.money(),100);c.money(Number.MAX_SAFE_INTEGER);assert.equal(c.res.grant('currency','0',1),false);});
test('shards and Key stone use actual item gain without adding mine IDs',()=>{const c=setup();c.res.setEnabled(true);assert.equal(c.res.grant('item','Red_shard',3),true);assert.equal(c.res.grant('item','Key_stone',1),true);assert.equal(c.item(),8);assert.equal(c.run('UndergroundItems.list.length'),1);});
test('flow is bounded by native requirement and not accumulated beyond it',()=>{const c=setup();c.res.setEnabled(true);assert.equal(c.res.grant('flow','flow',2000),true);assert.equal(c.flow(),1500);c.run('PurifyChamber.requirements.isCompleted=()=>false');c.flow(0);assert.equal(c.res.grant('flow','flow',100),false);assert.equal(c.flow(),0);});
test('direct orb and berry grant use selected resource only',()=>{const c=setup();c.res.setEnabled(true);assert.equal(c.res.grant('orb','Pink',2),true);assert.equal(c.orb(),2);assert.equal(c.res.grant('berry','0',3),true);assert.equal(c.game.farming.berryInventory[0](),5);});
test('hourly orb only counts observed online time and stops at exact count',()=>{const c=setup();Object.defineProperty(c.w.document,'visibilityState',{value:'visible',configurable:true});c.res.setEnabled(true);assert.equal(c.res.startOrbs(1),true);assert.equal(c.timers.size,1);c.advance(3600000);assert.equal(c.orb(),0);for(let i=0;i<3600;i++)c.advance(1000);assert.equal(c.orb(),1);assert.equal(c.timers.size,0);});
test('orb repeated start cannot stack and disabled/hidden time earns nothing',()=>{const c=setup();Object.defineProperty(c.w.document,'visibilityState',{value:'hidden',configurable:true});c.res.setEnabled(true);c.res.startOrbs(1);c.res.startOrbs(1);assert.equal(c.timers.size,1);for(let i=0;i<3600;i++)c.advance(1000);assert.equal(c.orb(),0);c.res.setEnabled(false);assert.equal(c.timers.size,0);assert.equal(c.res.startOrbs(1),false);});
test('unsupported game data fails closed and invalid orb budget never starts',()=>{const c=setup();c.res.setEnabled(true);for(const n of [0,-1,1.5,Infinity,101,''])assert.equal(c.res.startOrbs(n),false);c.game.dreamOrbController.orbs=[];assert.equal(c.res.startOrbs(1),false);delete c.game.wallet;assert.equal(c.res.grant('currency','0',20),false);assert.equal(c.timers.size,0);});
test('UI requires enable and performs selected manual command',()=>{const c=setup();const d=c.w.document;d.getElementById('resources-enabled').click();d.getElementById('resources-amount').value='15';d.getElementById('resources-grant').click();assert.equal(c.money(),115);d.getElementById('resources-enabled').click();assert.equal(d.getElementById('resources-grant').disabled,true);});

test('unique native item confirmation reports actual delta not requested quantity',()=>{
 const c=setup();c.res.setEnabled(true);c.item(0);
 c.w.ItemList.Key_stone.gain=()=>c.item(Math.max(c.item(),1));
 c.res.grant('item','Key_stone',50);
 assert.equal(c.item(),1);assert.match(c.w.document.getElementById('resources-status').textContent,/Applied 1 to Key_stone/);
 c.res.grant('item','Key_stone',50);
 assert.equal(c.item(),1);assert.match(c.w.document.getElementById('resources-status').textContent,/Applied 0 to Key_stone/);
});
