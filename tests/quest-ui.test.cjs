const test = require('node:test');
const assert = require('node:assert/strict');
const {load, observable, Currency} = require('./helpers.cjs');

function fixture() {
    const f = load('autoquestrunner.user.js', '<section id="questDisplayContainer"><button id="toggle-auto-quest">Auto</button></section><div class="battle-view"></div>', {Preload:{hideSplashScreen(){}}});
    f.run('AutoQuestRunner.init()');
    return {...f, runner:f.w.AutoQuestRunner};
}

test('one accessible runner switch is inside the quest panel and explains a missing dependency', () => {
    const {w,runner} = fixture();
    runner.init();
    const button = w.document.getElementById('auto-quest-runner');
    assert.equal(button.closest('#questDisplayContainer')?.id, 'questDisplayContainer');
    assert.equal(w.document.querySelectorAll('#auto-quest-runner').length, 1);
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    button.click();
    assert.equal(runner.active, false);
    assert.match(w.document.getElementById('auto-quest-runner-status').textContent, /Enable Auto Navigation/i);
    assert.equal(w.document.getElementById('auto-quest-runner-status').getAttribute('role'), 'status');
    assert.ok(w.document.getElementById('toggle-auto-quest'));
});

test('runner status describes actual session earnings supplies parallel waits and random attempts', () => {
    const {w,runner} = fixture();
    let now = 1000;
    w.Date.now = () => now;
    w.GameConstants = {Currency};
    const qp = observable(50);
    w.App.game.wallet = {currencies:[observable(100),qp,observable(5)]};
    w.App.game.pokeballs = {pokeballs:[2,3,4].map(n => ({quantity:observable(n)}))};
    w.PokeAutomationAdapters.adapters.navigation = {acquire:()=>true,release(){},inspect:()=>({status:'running'})};
    assert.equal(runner.start(), true);
    runner.currentPlan = {primary:{target:{kind:'route',number:1,region:0},estimateSource:'native prior'},background:[],reasons:[]};
    runner.acquired.push({name:'farm',adapter:{inspect:()=>({status:'waiting',reason:'Growing berries',progress:2}),release(){}}});
    runner.attemptProgress = {battles:20,hatches:3};
    runner.visibleQuests = [{type:'CatchShiniesQuest',amount:2,remaining:1}];
    runner.spend.money = 80;
    now += 60000;
    qp(60);
    runner.render();
    const text = w.document.getElementById('auto-quest-runner-status').textContent;
    assert.match(text, /Route 1/);
    assert.match(text, /10 QP.*10.*QP\/min/);
    assert.match(text, /Poké Ball 2.*Great Ball 3.*Ultra Ball 4/);
    assert.match(text, /80 money/);
    assert.match(text, /Farming: waiting.*Growing berries/);
    assert.match(text, /20 battles.*3 hatches.*no guaranteed/i);
    assert.match(text, /Shiny quest progress: 1 successful captures/);
    assert.match(text, /game mechanics estimate/);
    runner.stop('Manual travel');
    assert.equal(w.document.getElementById('auto-quest-runner').getAttribute('aria-pressed'), 'false');
    assert.match(w.document.getElementById('auto-quest-runner-status').textContent, /Manual travel/);
});

test('status stays readable when a fresh save has hundreds of locked destinations', () => {
    const {w,runner} = fixture();
    runner.active = true;
    runner.currentPlan = {primary:null,reasons:[...Array.from({length:300},(_,i)=>`route:0:${i}: Route locked`),'9:0: No unlocked native Shadow trainer encounter']};
    runner.reason = runner.currentPlan.reasons.join(' · ');
    runner.render();
    const text = w.document.getElementById('auto-quest-runner-status').textContent;
    assert.ok(text.length < 700);
    assert.match(text,/No unlocked native Shadow trainer encounter/);
    assert.doesNotMatch(text,/route:0:/);
    assert.doesNotMatch(text,/9:0:/);
});

test('navigation costs are visible separately from supply purchases', () => {
    const {w,runner} = fixture();
    runner.sessionStarted = Date.now(); runner.sessionQP = 0; runner.lastQP = 0;
    runner.spend = {money:80,dungeonToken:0};
    runner.acquired = [{name:'navigation',adapter:{inspect:()=>({costs:{money:20,dungeonToken:30}})}}];
    runner.render();
    const text = w.document.getElementById('auto-quest-runner-status').textContent;
    assert.match(text,/Supply spend: 80 money/);
    assert.match(text,/Navigation spend: 20 money.*30 dungeon tokens/);
});
