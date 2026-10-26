const test = require('node:test');
const assert = require('node:assert/strict');
const { load, observable } = require('./helpers.cjs');
function farm(storage = {}, now = 1000000) {
    const actions = [];
    const plots = Array.from({ length: 25 }, () => ({ berry: -1, mulch: -1 }));
    const h = load('simpleautofarmer.user.js', '<div id="shovelList"></div>', {
        App: { isUsingClient: true, game: { farming: {
            plotList: plots, getGrowthMultiplier: () => 1,
            handleWanderer: p => { actions.push('catch'); p.wanderer = null; },
            harvestAll: () => actions.push('harvest'), plantAll: () => actions.push('plant'),
            harvest: () => actions.push('replant'), plant() {}, addMulch: () => actions.push('mulch'),
        } } },
        MulchType: { None: -1, Surprise_Mulch: 1 },
        FarmController: { selectedBerry: observable(0), navigateIndex() {}, BERRIES_PER_PAGE: 8 },
    }, storage);
    h.w.Date.now = () => now;
    h.w.initAutoFarm();
    return { ...h, actions, plots, advance: ms => { now += ms; }, button: id => h.w.document.getElementById(id) };
}
function start(h, minutes) { h.button('auto-farm-minutes').value = minutes; h.button('auto-farm-timer-start').click(); }
test('farm loads independent labels and catch occupies a separate row', () => {
    const h = farm({ autoHarvestState: true, autoCatchState: true });
    assert.match(h.button('auto-harvest-toggle').textContent, /ON/);
    assert.match(h.button('auto-plant-toggle').textContent, /OFF/);
    assert.notEqual(h.button('auto-catch-toggle').parentElement.parentElement, h.button('auto-plant-toggle').parentElement.parentElement);
    assert.equal(h.timers.size, 1);
});
test('catch works alone, before harvesting, with no second loop and stops immediately', () => {
    const h = farm();
    h.plots[0].wanderer = {};
    h.button('auto-catch-toggle').click(); h.tick();
    assert.deepEqual(h.actions, ['catch']);
    h.button('auto-harvest-toggle').click(); h.plots[0].wanderer = {}; h.tick();
    assert.deepEqual(h.actions, ['catch', 'catch', 'harvest']);
    assert.equal(h.timers.size, 1);
    h.button('auto-catch-toggle').click(); h.button('auto-harvest-toggle').click(); h.tick();
    assert.equal(h.actions.length, 3); assert.equal(h.timers.size, 0);
});
test('deadline stops every active mode before spending or harvesting, persists OFF', () => {
    const h = farm({ autoPlantState: true, autoHarvestState: true, autoMulchState: true, autoCatchState: true });
    start(h, '1');
    assert.equal(h.timers.size, 1);
    assert.equal(h.w.localStorage.getItem('autoFarmStopAt'), '1060000');
    h.advance(60000); h.tick();
    assert.deepEqual(h.actions, []); assert.equal(h.timers.size, 0);
    for (const name of ['Plant', 'Harvest', 'Replant', 'Mulch', 'Catch']) assert.equal(h.w.localStorage.getItem(`auto${name}State`), 'false');
    assert.match(h.button('auto-farm-timer-status').textContent, /expired/i);
});
test('an expired saved deadline disables replant before the first tick on reload', () => {
    const h = farm({ autoReplantState: true, autoCatchState: true, autoFarmStopAt: 999999 });
    h.tick(); assert.deepEqual(h.actions, []); assert.equal(h.timers.size, 0);
    assert.equal(h.w.localStorage.getItem('autoReplantState'), 'false');
});
test('future deadline survives reload and cancellation keeps active modes', () => {
    const h = farm({ autoHarvestState: true, autoFarmStopAt: 1060000, autoFarmTimerMinutes: 1 });
    assert.match(h.button('auto-farm-timer-status').textContent, /1:00/);
    h.button('auto-farm-timer-cancel').click(); h.advance(60000); h.tick();
    assert.deepEqual(h.actions, ['harvest']); assert.equal(h.w.localStorage.getItem('autoFarmStopAt'), '0');
    assert.equal(h.button('auto-farm-minutes').value, '1');
});
test('invalid durations do not replace an armed timer, restart replaces its deadline', () => {
    const h = farm({ autoHarvestState: true }); start(h, '2');
    for (const value of ['', '0', '-1', '1.5', '10081', '1e309']) {
        start(h, value); assert.equal(h.w.localStorage.getItem('autoFarmStopAt'), '1120000');
    }
    h.advance(5000); start(h, '1');
    assert.equal(h.w.localStorage.getItem('autoFarmStopAt'), '1065000'); assert.equal(h.timers.size, 1);
});
test('timer alone never enables farming and fully releases its interval when cancelled', () => {
    const h = farm(); start(h, '1'); h.tick(); assert.deepEqual(h.actions, []);
    h.button('auto-farm-timer-cancel').click(); assert.equal(h.timers.size, 0);
});
