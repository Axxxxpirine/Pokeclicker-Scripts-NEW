const test = require('node:test');
const assert = require('node:assert/strict');
const { load, observable } = require('./helpers.cjs');
function farm() {
    const actions = [];
    const plots = Array.from({ length: 25 }, () => ({ berry: -1 }));
    plots[0] = { berry: 0, mulch: 0, age: 95, berryData: { growthTime: [1, 2, 3, 50, 100] }, getGrowthMultiplier: () => 1 };
    plots[1] = { ...plots[0], age: 40 };
    const h = load('simpleautofarmer.user.js', '<div id="shovelList"></div>', {
        App: { isUsingClient: true, game: { farming: { plotList: plots, getGrowthMultiplier: () => 1, harvest: (...a) => actions.push(['harvest', ...a]), plant: (...a) => actions.push(['plant', ...a]) } } },
        MulchType: { Surprise_Mulch: 1 },
        FarmController: { selectedBerry: observable(0), navigateIndex() {}, BERRIES_PER_PAGE: 8 },
    }, { autoReplantState: true });
    h.w.initAutoFarm();
    return { ...h, actions, plots };
}
test('farm replants a nearly withered plot using its current berry data', () => {
    const h = farm();
    h.tick();
    assert.deepEqual(h.actions, [['harvest', 0, false], ['plant', 0, 0, false]]);
    h.w.document.getElementById('auto-replant-toggle').click();
    h.tick();
    assert.equal(h.actions.length, 2);
    assert.equal(h.timers.size, 0);
});
test('surprise mulch harvests without replanting and empty plots are ignored', () => {
    const h = farm();
    h.plots[0].mulch = 1;
    h.tick();
    assert.deepEqual(h.actions, [['harvest', 0, false]]);
});
