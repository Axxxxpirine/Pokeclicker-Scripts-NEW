const test = require('node:test');
const assert = require('node:assert/strict');
const { load, observable } = require('./helpers.cjs');
function setup(storage = {}) {
    const actions = [];
    const plots = Array.from({ length: 25 }, () => ({ berry: -1, mulch: -1, mulchTimeLeft: 0, age: 0, isUnlocked: true, isSafeLocked: false, getGrowthMultiplier: () => 1, berryData: { growthTime: [1, 2, 3, 100, 200] } }));
    const farming = {
        plotList: plots, berryInventory: [observable(20), observable(20)], mulchList: [observable(20)],
        getGrowthMultiplier: () => 1, getMulchDurationMultiplier: () => 1,
        plant(index, berry) { actions.push(['plant', index, berry]); this.berryInventory[berry](this.berryInventory[berry]() - 1); plots[index].berry = berry; },
        harvest() { actions.push(['harvest']); }, harvestAll() { actions.push(['harvestAll']); },
        plantAll() { actions.push(['plantAll']); }, shovel() { actions.push(['shovel']); },
        addMulch(index, mulch, amount = 1) { actions.push(['mulch', index, mulch, amount]); this.mulchList[mulch](this.mulchList[mulch]() - amount); plots[index].mulch = mulch; plots[index].mulchTimeLeft += 300 * amount; },
    };
    const h = load('simpleautofarmer.user.js', '<div id="shovelList"></div>', {
        App: { isUsingClient: true, game: { farming } },
        BerryType: { None: -1, Cheri: 0, Chesto: 1, 0: 'Cheri', 1: 'Chesto' },
        MulchType: { None: -1, Rich_Mulch: 0, Surprise_Mulch: 1 },
        GameConstants: { MULCH_USE_TIME: 300 },
        FarmController: { selectedBerry: observable(0), navigateIndex() {}, BERRIES_PER_PAGE: 8 },
    }, storage);
    // Browser clearInterval returns undefined, unlike Map.delete in the shared helper.
    const clear = h.w.clearInterval;
    h.w.clearInterval = id => { clear(id); };
    h.w.initAutoFarm();
    const input = (id, value) => { const e = h.w.document.getElementById(id); assert.ok(e, `Missing ${id}`); e.value = value; e.dispatchEvent(new h.w.Event('change', { bubbles: true })); };
    const click = id => { const e = h.w.document.getElementById(id); assert.ok(e, `Missing ${id}`); e.click(); };
    return { ...h, plots, farming, actions, input, click };
}

test('manual plan and Rich Mulch start OFF even with old activation flags', () => {
    const h = setup({ autoFarmPlanState: true, autoFarmRichState: true });
    assert.equal(h.w.document.querySelectorAll('[data-farm-plan-plot]').length, 25);
    h.tick();
    assert.deepEqual(h.actions, []);
    assert.equal(h.timers.size, 0);
    assert.equal(h.w.localStorage.getItem('autoFarmPlanState'), 'false');
    assert.equal(h.w.localStorage.getItem('autoFarmRichState'), 'false');
});

test('manual plan plants selected empty plots only and never spends below each berry reserve', () => {
    const h = setup();
    for (let i = 0; i < 6; i++) h.input(`auto-farm-plan-${i}`, 0);
    h.input('auto-farm-plan-6', 1);
    h.input('auto-farm-plan-reserve', 18);
    h.plots[0].isUnlocked = false;
    h.plots[1].isSafeLocked = true;
    h.plots[2].berry = 1;
    h.click('auto-farm-plan-toggle'); h.tick(); h.tick();
    assert.deepEqual(h.actions, [['plant', 3, 0], ['plant', 4, 0], ['plant', 6, 1]]);
    assert.equal(h.farming.berryInventory[0](), 18);
    assert.equal(h.farming.berryInventory[1](), 19);
    assert.equal(h.plots[2].berry, 1);
    assert.equal(h.plots[7].berry, -1);
});

test('plan avoids destructive conflicts and regular planting explicitly disables the plan', () => {
    const h = setup({ autoHarvestState: true, autoPlantState: true });
    h.input('auto-farm-plan-0', 1);
    h.click('auto-farm-plan-toggle'); h.tick();
    assert.deepEqual(h.actions, [['plant', 0, 1]]);
    assert.equal(h.w.localStorage.getItem('autoHarvestState'), 'false');
    assert.equal(h.w.localStorage.getItem('autoPlantState'), 'false');
    h.click('auto-plant-toggle'); h.tick();
    assert.equal(h.w.localStorage.getItem('autoFarmPlanState'), 'false');
    assert.deepEqual(h.actions.at(-1), ['plantAll']);
    assert.equal(h.timers.size, 1);
});

test('plan settings persist, invalid values retain valid settings, and locked plots remain configurable', () => {
    const h = setup();
    h.input('auto-farm-plan-24', 1);
    h.input('auto-farm-plan-reserve', 25);
    for (const value of ['', '-1', '2.5', '1000000001']) h.input('auto-farm-plan-reserve', value);
    assert.equal(h.w.localStorage.getItem('autoFarmPlanReserve'), '25');
    const plan = JSON.parse(h.w.localStorage.getItem('autoFarmMutationPlan'));
    assert.equal(plan[24], 1);
    const reloaded = setup({ autoFarmMutationPlan: plan, autoFarmPlanReserve: 25 });
    assert.equal(reloaded.w.document.getElementById('auto-farm-plan-24').value, '1');
    assert.equal(reloaded.w.document.getElementById('auto-farm-plan-reserve').value, '25');
    assert.equal(reloaded.timers.size, 0);
});

test('Rich Mulch applies near maturity only, skips protected/occupied mulch plots and respects cap', () => {
    const h = setup();
    for (let i = 0; i < 9; i++) Object.assign(h.plots[i], { berry: 0, age: 90 });
    h.plots[0].isUnlocked = false; h.plots[1].isSafeLocked = true;
    h.plots[2].mulch = 1; h.plots[3].age = 40; h.plots[4].age = 100;
    h.input('auto-farm-rich-cap', 2); h.input('auto-farm-rich-reserve', 5);
    h.click('auto-farm-rich-toggle'); h.tick(); h.tick();
    assert.deepEqual(h.actions, [['mulch', 5, 0, 1], ['mulch', 6, 0, 1]]);
    assert.equal(h.farming.mulchList[0](), 18);
    assert.match(h.w.document.getElementById('auto-farm-rich-status').textContent, /2\/2/);
});

test('Rich Mulch reserve and actual maturity speed are checked before each spend', () => {
    const h = setup();
    h.farming.mulchList[0](6);
    h.input('auto-farm-rich-reserve', 5);
    h.input('auto-farm-rich-seconds', 10);
    for (let i = 0; i < 3; i++) Object.assign(h.plots[i], { berry: 0, age: 80, getGrowthMultiplier: () => 2 });
    h.click('auto-farm-rich-toggle'); h.tick();
    assert.deepEqual(h.actions, [['mulch', 0, 0, 1]]);
    assert.equal(h.farming.mulchList[0](), 5);
});

test('Rich Mulch and general remulching cannot bypass each other’s budgets', () => {
    const h = setup({ autoMulchState: true });
    Object.assign(h.plots[0], { berry: 0, age: 90 });
    h.click('auto-farm-rich-toggle');
    assert.equal(h.w.localStorage.getItem('autoMulchState'), 'false');
    h.tick();
    h.click('auto-mulch-toggle');
    assert.equal(h.w.localStorage.getItem('autoFarmRichState'), 'false');
});

test('deadline disables new modes before any action and releases the single interval', () => {
    const h = setup();
    h.input('auto-farm-plan-0', 1); h.click('auto-farm-plan-toggle'); h.click('auto-farm-rich-toggle');
    h.w.Date.now = () => 1000000;
    h.input('auto-farm-minutes', 1); h.click('auto-farm-timer-start');
    h.w.Date.now = () => 1060000; h.tick();
    assert.deepEqual(h.actions, []);
    assert.equal(h.timers.size, 0);
    assert.equal(h.w.localStorage.getItem('autoFarmPlanState'), 'false');
    assert.equal(h.w.localStorage.getItem('autoFarmRichState'), 'false');
});

test('invalid saved plans and spending limits recover without changing game inventory', () => {
    const h = setup({ autoFarmMutationPlan: [999, null, '1', 1.5, -2, 1], autoFarmPlanReserve: -1, autoFarmRichReserve: 'bad', autoFarmRichCap: 0, autoFarmRichSeconds: 99999 });
    assert.equal(h.w.document.getElementById('auto-farm-plan-0').value, '-1');
    assert.equal(h.w.document.getElementById('auto-farm-plan-5').value, '1');
    assert.equal(h.w.document.getElementById('auto-farm-rich-cap').value, '25');
    assert.equal(h.w.document.getElementById('auto-farm-rich-seconds').value, '30');
    h.click('auto-farm-plan-toggle'); h.tick();
    assert.deepEqual(h.actions, [['plant', 5, 1]]);
    assert.equal(h.farming.berryInventory[0](), 20);
});

test('Rich Mulch settings reject invalid edits and lowering cap never refunds spent units', () => {
    const h = setup();
    h.input('auto-farm-rich-cap', 3); h.input('auto-farm-rich-seconds', 5); h.input('auto-farm-rich-reserve', 2);
    for (const value of ['', '-1', '1.5', '1000000001']) {
        h.input('auto-farm-rich-cap', value); h.input('auto-farm-rich-seconds', value); h.input('auto-farm-rich-reserve', value);
    }
    assert.equal(h.w.localStorage.getItem('autoFarmRichCap'), '3');
    assert.equal(h.w.localStorage.getItem('autoFarmRichSeconds'), '5');
    assert.equal(h.w.localStorage.getItem('autoFarmRichReserve'), '2');
    Object.assign(h.plots[0], { berry: 0, age: 95 });
    Object.assign(h.plots[1], { berry: 0, age: 95 });
    h.click('auto-farm-rich-toggle'); h.tick();
    h.input('auto-farm-rich-cap', 1);
    Object.assign(h.plots[2], { berry: 0, age: 95 });
    h.tick();
    assert.equal(h.actions.length, 2);
    assert.match(h.w.document.getElementById('auto-farm-rich-status').textContent, /2\/1.*cap reached/);
});

test('Rich Mulch waits until one unit lasts to maturity and honors native refusal', () => {
    const h = setup();
    h.w.GameConstants.MULCH_USE_TIME = 5;
    Object.assign(h.plots[0], { berry: 0, age: 90 });
    h.click('auto-farm-rich-toggle'); h.tick();
    assert.deepEqual(h.actions, []);
    h.plots[0].age = 97;
    h.farming.canMulch = () => false;
    h.tick();
    assert.deepEqual(h.actions, []);
    h.farming.canMulch = () => true;
    h.tick();
    assert.deepEqual(h.actions, [['mulch', 0, 0, 1]]);
});

test('missing APIs, invalid stock and frozen crops fail closed without spending', () => {
    const h = setup();
    h.input('auto-farm-plan-0', 0); h.click('auto-farm-plan-toggle');
    h.farming.berryInventory[0](NaN);
    h.tick(); assert.deepEqual(h.actions, []);
    Object.assign(h.plots[1], { berry: 0, age: 95, getGrowthMultiplier: () => 0 });
    h.click('auto-farm-rich-toggle'); h.tick();
    assert.deepEqual(h.actions, []);
    h.plots[1].getGrowthMultiplier = () => 1;
    h.farming.mulchList[0](Infinity); h.tick();
    assert.deepEqual(h.actions, []);
    delete h.farming.getMulchDurationMultiplier;
    h.tick(); assert.deepEqual(h.actions, []);
    delete h.farming.plant;
    h.tick(); assert.deepEqual(h.actions, []);
});

test('OFF stops immediately, re-enabling creates one loop and a fresh explicit mulch budget', () => {
    const h = setup();
    h.input('auto-farm-rich-cap', 1);
    for (let i = 0; i < 3; i++) Object.assign(h.plots[i], { berry: 0, age: 95 });
    h.click('auto-farm-rich-toggle'); h.tick();
    h.click('auto-farm-rich-toggle'); h.tick();
    assert.equal(h.actions.length, 1);
    assert.equal(h.timers.size, 0);
    h.click('auto-farm-rich-toggle'); h.tick(); h.tick();
    assert.equal(h.actions.length, 2);
    assert.equal(h.timers.size, 1);
    h.click('auto-farm-rich-toggle');
    h.input('auto-farm-plan-4', 1); h.click('auto-farm-plan-toggle'); h.click('auto-farm-plan-toggle'); h.tick();
    assert.equal(h.actions.length, 2);
    assert.equal(h.timers.size, 0);
});
