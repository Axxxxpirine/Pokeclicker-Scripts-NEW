const test = require('node:test');
const assert = require('node:assert/strict');
const { load, observable } = require('./helpers.cjs');
function setup(storage = {}) {
    const clicks = [], sales = [];
    const tools = { selectedToolType: 2, getTool: type => ({ canUseTool: () => type < 2 }) };
    const mine = { timeUntilDiscovery: 0, completed: false, itemsBuried: 1, itemsFound: 0, grid: [{ layerDepth: 2, reward: { rewarded: false } }] };
    const underground = { canAccess: () => true, tools, mine };
    const stats = observable(10);
    const item = { itemName: 'Hard_stone', isSellable: () => true, sellLocked: () => false };
    const h = load('enhancedautomine.user.js', '<div id="mineModal"><div class="modal-body"><div id="mineBody"></div></div></div><div id="treasures"></div>', {
        App: { isUsingClient: true, game: { underground, statistics: { undergroundLayersMined: stats } } },
        UndergroundToolType: { Chisel: 0, Hammer: 1, Bomb: 2 },
        UndergroundItems: { list: [item] }, player: { itemList: { Hard_stone: () => 3 } },
        UndergroundController: { clickModalMineSquare: index => clicks.push([index, tools.selectedToolType]), sellMineItem: (it, n) => sales.push([it.itemName, n]) },
    }, storage);
    return { ...h, clicks, sales, underground, mine, tools, stats, item };
}
test('mine initializes in the current modal and toggles one stoppable timer', () => {
    const h = setup({ autoMineState: true });
    h.w.initAutoMine();
    assert.ok(h.w.document.querySelector('#auto-mine-start'));
    h.w.document.querySelector('#auto-mine-start').click();
    h.tick();
    assert.equal(h.clicks.length, 0);
    assert.equal(h.timers.size, 0);
    h.w.document.querySelector('#auto-mine-start').click();
    assert.equal(h.timers.size, 1);
    h.tick();
    assert.equal(h.clicks.length, 1);
    h.w.document.querySelector('#auto-mine-start').click();
    assert.equal(h.timers.size, 0);
});
test('mine excavates a reward with a non-destructive tool and restores manual selection', () => {
    const h = setup({ autoMineState: true });
    h.w.doAutoMine();
    assert.deepEqual(h.clicks, [[0, 0]]);
    assert.equal(h.tools.selectedToolType, 2);
});
test('mine waits for access, discovery, durability and a current unfinished mine', () => {
    const h = setup({ autoMineState: true });
    h.underground.canAccess = () => false;
    h.w.doAutoMine();
    h.underground.canAccess = () => true;
    h.mine.timeUntilDiscovery = 5;
    h.w.doAutoMine();
    h.mine.timeUntilDiscovery = 0;
    h.mine.completed = true;
    h.w.doAutoMine();
    h.mine.completed = false;
    h.tools.getTool = () => ({ canUseTool: () => false });
    h.w.doAutoMine();
    h.underground.mine = null;
    h.w.doAutoMine();
    assert.equal(h.clicks.length, 0);
});
test('auto sell only sells unlocked sellable inventory after a completed layer', () => {
    const h = setup({ autoMineState: true, autoSellTreasure: true });
    h.w.initAutoMine();
    h.tick();
    assert.equal(h.sales.length, 0);
    h.stats(11);
    h.tick();
    assert.deepEqual(h.sales, [['Hard_stone', 3]]);
    h.item.sellLocked = () => true;
    h.stats(12);
    h.tick();
    assert.equal(h.sales.length, 1);
});
test('mine falls back to Hammer when Chisel needs to recover', () => {
    const h = setup({ autoMineState: true });
    h.tools.getTool = type => ({ canUseTool: () => type === 1 });
    h.w.doAutoMine();
    assert.deepEqual(h.clicks, [[0, 1]]);
});
