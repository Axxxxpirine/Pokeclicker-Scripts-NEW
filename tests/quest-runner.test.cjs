const test=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('./helpers.cjs');
function setup(){ const f=load('autoquestrunner.user.js','<div class="battle-view"></div>',{Preload:{hideSplashScreen(){}}}); f.run('AutoQuestRunner.init()'); return f; }
test('runner initializes OFF and rejects unavailable adapters without gameplay',()=>{const f=setup();const r=f.w.AutoQuestRunner;assert.equal(r.version,1);assert.equal(r.active,false);assert.equal(r.start(['navigation']),false);assert.equal(r.active,false);});
test('registry survives either order and session invalidates on manual control',()=>{const f=setup();let releases=0;f.w.PokeAutomationAdapters.adapters.navigation={inspect:()=>({status:'ready'}),acquire:()=>true,apply:()=>true,release:()=>releases++};const r=f.w.AutoQuestRunner;assert.equal(r.start(['navigation']),true);const token=r.owner;assert.equal(r.start(['navigation']),false);assert.equal(token.isCurrent(),true);token.onManual('travel');assert.equal(token.active,false);assert.equal(token.isCurrent(),false);assert.equal(releases,1);assert.equal(r.apply('navigation',{}),false);r.init();assert.equal(r.active,false);});
