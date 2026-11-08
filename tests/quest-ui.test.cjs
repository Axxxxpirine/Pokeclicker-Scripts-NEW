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

test('unchanged runner controls preserve translated text without DOM mutations', () => {
    const {w,runner} = fixture();
    const button = w.document.getElementById('auto-quest-runner');
    const timer = w.document.getElementById('auto-quest-refresh-status');
    button.textContent = 'Translated OFF';
    timer.textContent = 'Translated timer OFF';
    const observer = new w.MutationObserver(() => {});
    observer.observe(button, {subtree:true,childList:true,characterData:true,attributes:true});
    observer.observe(timer, {subtree:true,childList:true,characterData:true,attributes:true});
    runner.render();
    assert.equal(button.textContent, 'Translated OFF');
    assert.equal(timer.textContent, 'Translated timer OFF');
    assert.equal(observer.takeRecords().length, 0);
    runner.active = true;
    runner.render();
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.match(button.textContent, /ON/);
    runner.setRefreshTimer(true, 5);
    assert.match(timer.textContent, /Next reset in 5:00/);
    observer.disconnect();
});

test('changing session counters preserves unchanged translated status lines', () => {
    const {w,runner} = fixture();
    let now = 1000;
    w.Date.now = () => now;
    runner.active = true;
    runner.sessionStarted = now;
    runner.sessionQP = 60;
    runner.lastQP = 0;
    runner.reason = 'Counting actual native stages';
    runner.render();
    const status = w.document.getElementById('auto-quest-runner-status');
    const heading = status.children[0], reason = status.children[1];
    heading.textContent = 'Translated activity';
    reason.textContent = 'Translated reason';
    now += 60000;
    runner.render();
    assert.equal(status.children[0], heading);
    assert.equal(status.children[1], reason);
    assert.equal(heading.textContent, 'Translated activity');
    assert.equal(reason.textContent, 'Translated reason');
    assert.match(status.textContent, /60\.0 QP\/min/);
    runner.reason = '';
    runner.render();
    assert.doesNotMatch(status.textContent, /Translated reason/);
    runner.active = false;
    runner.sessionStarted = null;
    runner.render();
    assert.equal(status.children.length, 1);
    assert.match(status.textContent, /OFF.*Ready when enabled/);
});
