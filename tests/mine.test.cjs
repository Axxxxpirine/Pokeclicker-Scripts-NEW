const test = require('node:test');
const assert = require('node:assert/strict');
const { load, observable } = require('./helpers.cjs');
function setup(storage = {}) {
    const clicks = [], sales = [];
    const toolList = [0, 1].map(id => ({ id, durability: 1, durabilityPerUse: id === 0 ? 0.02 : 0.06,
        restoreRatePerSecond: () => 0.001, canUseTool() { return this.durability >= this.durabilityPerUse; } }));
    const tools = { selectedToolType: 2, getTool: type => toolList.find(tool => tool.id === type) };
    const mine = { width: 1, height: 1, timeUntilDiscovery: 0, completed: false, itemsBuried: 1, itemsFound: 0, grid: [{ layerDepth: 2, reward: { rewardID: 0, rewarded: false } }] };
    const battery = {
        charges: 0, maxCharges: 60, discharges: 0, activeDischargeID: null,
        canDischarge() { return this.charges >= this.maxCharges && !mine.completed && mine.timeUntilDiscovery <= 0; },
        discharge() { this.discharges++; this.charges = 0; this.activeDischargeID = 'Eruption'; },
        toJSON() { return { activeDischargeID: this.activeDischargeID }; },
    };
    const underground = { canAccess: () => true, tools, mine, battery };
    const stats = observable(10);
    const found = observable(20);
    const autoRestart = observable(true);
    const item = { itemName: 'Hard_stone', isSellable: () => true, sellLocked: () => false };
    const h = load('enhancedautomine.user.js', '<div id="mineModal"><div class="modal-body"><div id="mineBody"></div></div></div><div id="treasures"></div>', {
        App: { isUsingClient: true, game: { underground, statistics: { undergroundLayersMined: stats, undergroundItemsFound: found } } },
        Settings: { getSetting: () => ({ observableValue: autoRestart }) },
        UndergroundToolType: { Chisel: 0, Hammer: 1, Bomb: 2, Survey: 3 },
        UndergroundItems: { list: [item] }, player: { itemList: { Hard_stone: () => 3 } },
        UndergroundController: { clickModalMineSquare: index => clicks.push([index, tools.selectedToolType]), sellMineItem: (it, n) => sales.push([it.itemName, n]) },
    }, storage);
    const delays = [];
    const schedule = h.w.setTimeout;
    h.w.setTimeout = (fn, delay) => { delays.push(delay); return schedule(fn, delay); };
    let now = 0;
    h.w.performance.now = () => now;
    return { ...h, clicks, sales, underground, mine, tools, toolList, stats, found, autoRestart, item, battery, delays, setNow: value => { now = value; } };
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

test('full battery discharges before tools, waits for animation, then resumes mining', () => {
    const h = setup({ autoMineState: true });
    h.battery.charges = 60;
    h.w.doAutoMine();
    assert.equal(h.battery.discharges, 1);
    assert.equal(h.battery.charges, 0);
    assert.deepEqual(h.clicks, []);
    h.w.doAutoMine();
    assert.equal(h.battery.discharges, 1);
    assert.deepEqual(h.clicks, []);
    h.battery.activeDischargeID = null;
    h.w.doAutoMine();
    assert.deepEqual(h.clicks, [[0, 0]]);
});

test('battery respects the native full threshold and discharge eligibility', () => {
    const h = setup({ autoMineState: true });
    for (const charge of [0, 30, 59.9]) {
        h.battery.charges = charge;
        h.w.doAutoMine();
        assert.equal(h.battery.discharges, 0);
    }
    h.battery.charges = 60;
    h.battery.canDischarge = () => false;
    h.w.doAutoMine();
    assert.equal(h.battery.discharges, 0);
    assert.equal(h.clicks.length, 4);
});

test('battery works even when both tools lack durability', () => {
    const h = setup({ autoMineState: true });
    h.tools.getTool = () => ({ canUseTool: () => false });
    h.battery.charges = 60;
    h.w.doAutoMine();
    assert.equal(h.battery.discharges, 1);
    assert.deepEqual(h.clicks, []);
});

test('battery toggle persists, uses the existing timer and obeys Auto Mine OFF', () => {
    const h = setup({ autoMineState: true });
    h.w.initAutoMine();
    const button = h.w.document.querySelector('#auto-mine-battery');
    assert.ok(button);
    assert.match(button.textContent, /ON/);
    button.click();
    assert.equal(h.w.localStorage.getItem('autoMineBattery'), 'false');
    h.battery.charges = 60;
    h.tick();
    assert.equal(h.battery.discharges, 0);
    assert.equal(h.clicks.length, 1);
    h.w.document.querySelector('#auto-mine-start').click();
    button.click();
    assert.equal(h.w.localStorage.getItem('autoMineBattery'), 'true');
    assert.equal(h.timers.size, 0);
    h.w.doAutoMine();
    assert.equal(h.battery.discharges, 0);
    h.w.document.querySelector('#auto-mine-start').click();
    assert.equal(h.timers.size, 1);
    h.tick();
    assert.equal(h.battery.discharges, 1);
});

test('saved battery OFF survives initialization and does not discharge', () => {
    const h = setup({ autoMineState: true, autoMineBattery: false });
    h.w.initAutoMine();
    const button = h.w.document.querySelector('#auto-mine-battery');
    assert.ok(button);
    assert.match(button.textContent, /OFF/);
    h.battery.charges = 60;
    h.tick();
    assert.equal(h.battery.discharges, 0);
    assert.equal(h.clicks.length, 1);
});

test('battery waits for access and a discovered, unfinished mine with buried rewards', () => {
    const h = setup({ autoMineState: true });
    h.battery.charges = 60;
    h.underground.canAccess = () => false;
    h.w.doAutoMine();
    h.underground.canAccess = () => true;
    h.mine.timeUntilDiscovery = 1;
    h.w.doAutoMine();
    h.mine.timeUntilDiscovery = 0;
    h.mine.completed = true;
    h.w.doAutoMine();
    h.mine.completed = false;
    h.mine.itemsFound = h.mine.itemsBuried;
    h.w.doAutoMine();
    h.underground.mine = null;
    h.w.doAutoMine();
    assert.equal(h.battery.discharges, 0);
    assert.deepEqual(h.clicks, []);
});

test('missing battery API does not prevent tool mining', () => {
    const h = setup({ autoMineState: true });
    for (const battery of [undefined, {}, { canDischarge: () => true }]) {
        h.underground.battery = battery;
        h.w.doAutoMine();
    }
    assert.equal(h.clicks.length, 3);
});

test('manual battery animation pauses tools even with auto battery disabled', () => {
    const h = setup({ autoMineState: true, autoMineBattery: false });
    h.battery.activeDischargeID = 'Eruption';
    h.w.doAutoMine();
    assert.equal(h.battery.discharges, 0);
    assert.deepEqual(h.clicks, []);
});

function grid(h, width, cells) {
    h.mine.width = width;
    h.mine.height = cells.length / width;
    h.mine.grid = cells.map(([depth, id]) => ({ layerDepth: depth,
        reward: id === undefined ? undefined : { rewardID: id, rewarded: false } }));
}

function extraTools(h, bonus = 0) {
    for (const [id, cost] of [[2, 0.18], [3, 1]]) {
        h.toolList.push({ id, durability: 1, durabilityPerUse: cost,
            restoreRatePerSecond: () => 0.001,
            canUseTool() { return this.durability >= this.durabilityPerUse; } });
    }
    h.w.OakItemType = { Explosive_Charge: 7 };
    h.w.App.game.oakItems = { isActive: () => bonus > 0, calculateBonus: () => bonus };
}

test('Survey finds hidden treasure even while excavation tools are recovering, then respects its active hint', () => {
    const h = setup({ autoMineState: true });
    extraTools(h);
    h.toolList[0].durability = h.toolList[1].durability = 0;
    h.w.doAutoMine();
    assert.deepEqual(h.clicks, [[0, 3]]);
    assert.equal(h.tools.selectedToolType, 2);
    h.mine.grid[0].survey = 5;
    h.mine.grid[0].surveyRewardID = 0;
    h.toolList[0].durability = 1;
    h.w.doAutoMine();
    assert.deepEqual(h.clicks.at(-1), [0, 0]);
});

test('Survey skips partially visible treasures and can survey a new mine', () => {
    const h = setup({ autoMineState: true });
    extraTools(h);
    grid(h, 2, [[0, 0], [2, 0]]);
    h.w.doAutoMine();
    assert.deepEqual(h.clicks, [[1, 0]]);
    grid(h, 2, [[3, 1], [3, 1]]);
    h.underground.mine = { ...h.mine };
    h.w.doAutoMine();
    assert.equal(h.clicks.at(-1)[1], 3);
});

test('Bomb uses its independent durability when no treasure can be completed by its ten random hits', () => {
    const h = setup({ autoMineState: true });
    extraTools(h);
    h.toolList[0].durability = h.toolList[1].durability = h.toolList[3].durability = 0;
    // Six depth-3 tiles require twelve hits, including repeated hits on a tile.
    grid(h, 6, Array.from({ length: 6 }, () => [3, 0]));
    h.w.doAutoMine();
    assert.deepEqual(h.clicks, [[0, 2]]);
});

test('Bomb protection checks every treasure, repeated hits and the Explosive Charge bonus', () => {
    for (const [cells, bonus] of [
        [Array.from({ length: 5 }, () => [3, 0]), 0],
        [[[3, 0], [3, 0], [3, 0], [3, 0], [3, 0], [3, 0], [1, 1]], 0],
        [Array.from({ length: 6 }, () => [3, 0]), 2],
    ]) {
        const h = setup({ autoMineState: true });
        extraTools(h, bonus);
        h.toolList[3].durability = 0;
        grid(h, cells.length, cells);
        h.w.doAutoMine();
        assert.ok(h.clicks.length === 1);
        assert.notEqual(h.clicks[0][1], 2);
        h.dom.window.close();
    }
});

test('Bomb safety is recomputed after excavation and unavailable bonus information fails closed', () => {
    const h = setup({ autoMineState: true });
    extraTools(h);
    h.toolList[3].durability = 0;
    grid(h, 6, Array.from({ length: 6 }, () => [3, 0]));
    h.w.doAutoMine();
    assert.equal(h.clicks.at(-1)[1], 2);
    h.mine.grid[0].layerDepth = 0;
    h.w.doAutoMine();
    assert.notEqual(h.clicks.at(-1)[1], 2);
    h.mine.grid[0].layerDepth = 3;
    delete h.w.App.game.oakItems;
    h.w.doAutoMine();
    assert.notEqual(h.clicks.at(-1)[1], 2);
});

test('special tools obey battery animation, Auto Mine OFF and mine lifecycle gates', () => {
    const h = setup({ autoMineState: true });
    extraTools(h);
    h.battery.activeDischargeID = 'Eruption'; h.w.doAutoMine();
    h.battery.activeDischargeID = null;
    h.underground.canAccess = () => false; h.w.doAutoMine();
    h.underground.canAccess = () => true;
    h.mine.timeUntilDiscovery = 1; h.w.doAutoMine();
    h.mine.timeUntilDiscovery = 0;
    h.mine.completed = true; h.w.doAutoMine();
    h.mine.completed = false;
    h.w.mineState = false; h.w.doAutoMine();
    assert.deepEqual(h.clicks, []);
});

test('recovering Survey wakes the timer before the exhausted excavation tools', () => {
    const h = setup({ autoMineState: true });
    extraTools(h);
    h.toolList.forEach(tool => { tool.durability = 0; });
    h.toolList[3].durability = 0.9995;
    assert.equal(h.w.doAutoMine(), 500);
});

test('adaptive timer runs charged tools at 20 attempts per second and backs off for recovery', () => {
    const h = setup({ autoMineState: true });
    h.w.initAutoMine();
    h.tick();
    assert.equal(h.delays.at(-1), 50);
    h.toolList[0].durability = 0.01;
    h.toolList[0].restoreRatePerSecond = () => 0.02;
    h.toolList[1].durability = 0;
    h.tick();
    assert.equal(h.delays.at(-1), 500);
    assert.equal(h.clicks.length, 1);
    assert.equal(h.timers.size, 1);
    h.toolList[0].durability = 0.02;
    h.tick();
    assert.equal(h.delays.at(-1), 50);
    assert.equal(h.clicks.length, 2);
    h.w.document.querySelector('#auto-mine-start').click();
    assert.equal(h.timers.size, 0);
});

test('idle mine checks at most once a second and never catches up with a burst', () => {
    const h = setup({ autoMineState: true });
    h.mine.timeUntilDiscovery = 30;
    h.w.initAutoMine();
    h.tick();
    assert.equal(h.delays.at(-1), 1000);
    h.mine.timeUntilDiscovery = 0;
    h.setNow(60000);
    h.tick();
    assert.equal(h.clicks.length, 1);
});

test('dense treasure cluster uses the center of the Hammer area', () => {
    const h = setup({ autoMineState: true });
    grid(h, 3, Array.from({length: 9}, () => [2, 0]));
    h.w.doAutoMine();
    assert.deepEqual(h.clicks, [[4, 1]]);
    assert.equal(h.tools.selectedToolType, 2);
});

test('Hammer may target an empty center to cover surrounding treasures', () => {
    const h = setup({ autoMineState: true });
    grid(h, 3, Array.from({length: 9}, (_, i) => i === 4 ? [0] : [2, 0]));
    h.w.doAutoMine();
    assert.deepEqual(h.clicks, [[4, 1]]);
});

test('Chisel favors finishing a nearly uncovered treasure over the first buried one', () => {
    const h = setup({ autoMineState: true });
    grid(h, 6, [[2, 0], [2, 0], [0], [0], [0, 1], [1, 1]]);
    h.w.doAutoMine();
    assert.deepEqual(h.clicks, [[5, 0]]);
});

test('Hammer neighborhoods never wrap across row edges', () => {
    const h = setup({ autoMineState: true });
    grid(h, 4, [[0], [0], [0], [2, 0], [2, 1], [0], [0], [0]]);
    h.w.doAutoMine();
    assert.deepEqual(h.clicks, [[3, 0]]);
});

test('zero-cost tools favor useful coverage and rewarded tiles are ignored', () => {
    const h = setup({ autoMineState: true });
    h.toolList.forEach(tool => { tool.durabilityPerUse = 0; tool.durability = 0; });
    grid(h, 3, Array.from({length: 9}, () => [2, 0]));
    h.w.doAutoMine();
    assert.deepEqual(h.clicks, [[4, 1]]);
    h.mine.grid.forEach(tile => { tile.reward.rewarded = true; });
    h.w.doAutoMine();
    assert.equal(h.clicks.length, 1);
});

test('tool selection is restored after a native click throws and automation stops cleanly', () => {
    const h = setup({ autoMineState: true });
    h.w.console = { ...console, error() {} };
    h.w.UndergroundController.clickModalMineSquare = () => { throw new Error('native click failed'); };
    h.w.initAutoMine();
    h.tick();
    assert.equal(h.tools.selectedToolType, 2);
    assert.equal(h.timers.size, 0);
    assert.equal(h.w.localStorage.getItem('autoMineState'), 'false');
    assert.match(h.w.document.querySelector('#auto-mine-status').textContent, /error/i);
});

test('sale reserves keep a default stock and allow item overrides including zero', () => {
    const h = setup({ autoMineState: true, autoSellTreasure: true,
        autoMineSellReserves: { default: 2, items: { Hard_stone: 1 } } });
    h.w.initAutoMine();
    h.stats(11);
    h.tick();
    assert.deepEqual(h.sales, [['Hard_stone', 2]]);
    h.w.autoMineSellReserves.items.Hard_stone = 0;
    h.stats(12);
    h.tick();
    assert.deepEqual(h.sales.at(-1), ['Hard_stone', 3]);
    delete h.w.autoMineSellReserves.items.Hard_stone;
    h.stats(13);
    h.tick();
    assert.deepEqual(h.sales.at(-1), ['Hard_stone', 1]);
});

test('stock below reserve, locked items and non-sellable items are never sold', () => {
    const h = setup({ autoMineState: true, autoSellTreasure: true,
        autoMineSellReserves: { default: 5, items: {} } });
    h.w.initAutoMine();
    h.stats(11);
    h.tick();
    h.w.autoMineSellReserves.default = 0;
    h.item.sellLocked = () => true;
    h.stats(12); h.tick();
    h.item.sellLocked = () => false;
    h.item.isSellable = () => false;
    h.stats(13); h.tick();
    assert.deepEqual(h.sales, []);
});

test('reserve controls persist overrides, blank inherits default and invalid edits pause selling', () => {
    const h = setup({ autoMineState: true, autoSellTreasure: true });
    h.w.initAutoMine();
    const defaults = h.w.document.querySelector('#auto-mine-reserve-default');
    const override = h.w.document.querySelector('#auto-mine-reserve-item');
    assert.ok(defaults); assert.ok(override);
    function change(input, value) { input.value = value; input.dispatchEvent(new h.w.Event('change')); }
    change(defaults, '2'); change(override, '1');
    assert.deepEqual(JSON.parse(h.w.localStorage.getItem('autoMineSellReserves')), {default: 2, items: {Hard_stone: 1}});
    change(override, '');
    assert.deepEqual(JSON.parse(h.w.localStorage.getItem('autoMineSellReserves')), {default: 2, items: {}});
    for (const value of ['-1', '1.5', '1000000001']) {
        change(defaults, value);
        h.stats(h.stats() + 1); h.tick();
    }
    assert.deepEqual(h.sales, []);
    change(defaults, '1'); h.stats(h.stats() + 1); h.tick();
    assert.deepEqual(h.sales, [['Hard_stone', 2]]);
});

test('corrupt saved reserves fail closed until explicitly replaced', () => {
    for (const value of [null, [], {default: -1, items: {}}, {default: 0, items: {Hard_stone: 'bad'}}]) {
        const h = setup({ autoMineState: true, autoSellTreasure: true, autoMineSellReserves: value });
        h.w.initAutoMine();
        h.w.document.querySelector('#auto-mine-reserve-default').dispatchEvent(new h.w.Event('blur'));
        h.stats(11); h.tick();
        assert.deepEqual(h.sales, []);
        assert.match(h.w.document.querySelector('#auto-mine-reserve-message').textContent, /paused/i);
        h.dom.window.close();
    }
});

test('status explains access, search, battery, recovery, missing targets and restart OFF', () => {
    const h = setup({ autoMineState: true });
    h.w.initAutoMine();
    const status = () => h.w.document.querySelector('#auto-mine-status').textContent;
    h.underground.canAccess = () => false; h.tick(); assert.match(status(), /access/i);
    h.underground.canAccess = () => true;
    h.mine.timeUntilDiscovery = 12; h.tick(); assert.match(status(), /12/);
    h.mine.timeUntilDiscovery = 0;
    h.battery.activeDischargeID = 'Eruption'; h.tick(); assert.match(status(), /battery/i);
    h.battery.activeDischargeID = null;
    h.toolList.forEach(tool => { tool.durability = 0; }); h.tick(); assert.match(status(), /recover/i);
    h.toolList.forEach(tool => { tool.durability = 1; });
    h.mine.grid[0].reward.rewarded = true; h.tick(); assert.match(status(), /target/i);
    h.mine.completed = true; h.autoRestart(false); h.tick();
    assert.match(status(), /complete/i);
    assert.match(h.w.document.querySelector('#auto-mine-warning').textContent, /Auto Restart.*OFF/);
    assert.equal(h.autoRestart(), false);
});

test('session rates use elapsed time, freeze on stop and reset on next start', () => {
    const h = setup({ autoMineState: true });
    h.w.initAutoMine();
    const rate = () => h.w.document.querySelector('#auto-mine-rates').textContent;
    h.setNow(60000); h.found(26); h.stats(12); h.tick();
    assert.match(rate(), /6 treasures/);
    assert.match(rate(), /6\.0\/min/);
    assert.match(rate(), /2 layers/);
    assert.match(rate(), /2\.0\/min/);
    const button = h.w.document.querySelector('#auto-mine-start');
    button.click();
    const stopped = rate();
    h.setNow(120000); h.found(40); h.tick();
    assert.equal(rate(), stopped);
    button.click();
    assert.match(rate(), /0 treasures/);
});

test('sales pause while a valid reserve edit is still uncommitted', () => {
    const h = setup({ autoMineState: true, autoSellTreasure: true });
    h.w.initAutoMine();
    const input = h.w.document.querySelector('#auto-mine-reserve-default');
    input.value = '2'; input.dispatchEvent(new h.w.Event('input'));
    h.stats(11); h.tick();
    assert.deepEqual(h.sales, []);
    input.dispatchEvent(new h.w.Event('change'));
    h.stats(12); h.tick();
    assert.deepEqual(h.sales, [['Hard_stone', 1]]);
});

test('restart does not sell stock for layers completed while automation was stopped', () => {
    const h = setup({ autoMineState: true, autoSellTreasure: true });
    h.w.initAutoMine();
    const button = h.w.document.querySelector('#auto-mine-start');
    button.click(); h.stats(12); button.click(); h.tick();
    assert.deepEqual(h.sales, []);
    h.stats(13); h.tick();
    assert.deepEqual(h.sales, [['Hard_stone', 3]]);
});

test('recovery delay remains bounded with zero, missing and very fast regeneration', () => {
    const h = setup({ autoMineState: true });
    h.toolList.forEach(tool => { tool.durability = 0; tool.restoreRatePerSecond = () => 0; });
    assert.equal(h.w.doAutoMine(), 1000);
    h.toolList[0].restoreRatePerSecond = () => 100;
    assert.equal(h.w.doAutoMine(), 50);
    h.tools.getTool = () => undefined;
    assert.equal(h.w.doAutoMine(), 1000);
});

test('target choice is recomputed after the current mine is replaced', () => {
    const h = setup({ autoMineState: true });
    h.w.doAutoMine();
    grid(h, 3, Array.from({length: 9}, () => [2, 1]));
    h.underground.mine = { ...h.mine };
    h.w.doAutoMine();
    assert.deepEqual(h.clicks, [[0, 0], [4, 1]]);
});

test('finishing an edit at its original value resumes selling even without a change event', () => {
    const h = setup({ autoMineState: true, autoSellTreasure: true });
    h.w.initAutoMine();
    const input = h.w.document.querySelector('#auto-mine-reserve-default');
    input.value = '2'; input.dispatchEvent(new h.w.Event('input'));
    input.value = '0'; input.dispatchEvent(new h.w.Event('input'));
    // Browsers do not dispatch change if the field ends with its original value.
    input.dispatchEvent(new h.w.Event('blur'));
    h.stats(11); h.tick();
    assert.deepEqual(h.sales, [['Hard_stone', 3]]);
});

test('quest-owned mining bypasses even a safe charged Bomb and standalone Bomb behavior resumes after release', () => {
    const h = setup({ autoMineState: true });
    extraTools(h);
    h.toolList[3].durability = 0;
    grid(h, 6, Array.from({ length: 6 }, () => [3, 0]));
    h.w.doAutoMine();
    assert.equal(h.clicks.at(-1)[1], 2, 'standalone uses the safe Bomb');

    h.w.registerQuestMineAdapter();
    const adapter = h.w.PokeAutomationAdapters.adapters.mine;
    const owner = { active: true, isCurrent() { return this.active; } };
    assert.equal(adapter.acquire(owner), true);
    h.clicks.length = 0;
    adapter.apply(owner, {});
    assert.equal(h.clicks.length, 1);
    assert.ok([0, 1].includes(h.clicks[0][1]), 'owned action excavates with Chisel or Hammer');
    assert.equal(h.tools.selectedToolType, 2, 'manual tool selection is restored');

    h.clicks.length = 0;
    h.toolList[0].durability = h.toolList[1].durability = 0;
    h.tick();
    assert.deepEqual(h.clicks, [], 'owned mining waits despite a charged safe Bomb');
    assert.match(adapter.inspect().reason, /recovering/);

    owner.active = false;
    adapter.release(owner);
    h.w.doAutoMine();
    assert.deepEqual(h.clicks, [[0, 2]], 'standalone special tools are preserved after release');
});

function leaseMine(h) {
    const adapter = h.w.PokeAutomationAdapters.adapters.mine;
    const token = {active:true,isCurrent() {return this.active;},onManual(reason) {this.active=false;adapter.release(this,reason);}};
    assert.equal(adapter.acquire(token),true);
    return {adapter,token};
}
// Catches manual settings cancellation leaving restored ON without a worker.
for (const control of ['auto-mine-battery','auto-mine-reserve-default']) {
    test(`quest mine restores the standalone timer after real ${control} interaction`, () => {
        const h=setup({autoMineState:true});h.w.initAutoMine();
        const {adapter,token}=leaseMine(h);adapter.apply(token,{});
        h.w.document.getElementById(control).click();
        assert.equal(token.active,false);assert.equal(h.w.mineState,true);
        assert.equal(h.timers.size,1);
        h.clicks.length=0;h.tick();assert.equal(h.clicks.length,1);
        assert.equal(h.timers.size,1);
    });
}
// Catches using coordination apply calls as the only worker, or bypassing adaptive waits.
test('quest mine owns an adaptive 50ms worker and coordination does not add actions', () => {
    const h=setup({autoMineState:false,autoSellTreasure:true});h.w.initAutoMine();
    const {adapter,token}=leaseMine(h);adapter.apply(token,{});
    assert.equal(h.clicks.length,1);assert.equal(h.timers.size,1);
    assert.equal(h.delays.at(-1),50);
    for(let i=0;i<4;i++) h.tick();
    assert.equal(h.clicks.length,5);
    adapter.apply(token,{});assert.equal(h.clicks.length,5);
    h.toolList[0].durability=0.01;h.toolList[0].restoreRatePerSecond=()=>0.02;
    h.toolList[1].durability=0;h.tick();assert.equal(h.delays.at(-1),500);
    adapter.apply(token,{});assert.equal(h.clicks.length,5);
    h.stats(11);h.tick();assert.deepEqual(h.sales,[]);
    token.active=false;adapter.release(token);
    assert.equal(h.timers.size,0);assert.equal(h.w.mineState,false);
});
// Catches queued callbacks mining after release, or acting under an invalid quest token.
test('released and invalid quest mine callbacks cannot mine or schedule another worker', () => {
    const h=setup({autoMineState:true});h.w.initAutoMine();
    const staleStandalone=[...h.timers.values()][0];
    const {adapter,token}=leaseMine(h);adapter.apply(token,{});
    staleStandalone();assert.equal(h.clicks.length,1);assert.equal(h.timers.size,1);
    const staleOwned=[...h.timers.values()][0];
    token.active=false;adapter.release(token);
    staleOwned();assert.equal(h.clicks.length,1);assert.equal(h.timers.size,1);
    const owned=leaseMine(h);owned.adapter.apply(owned.token,{});
    const count=h.clicks.length;owned.token.active=false;h.tick();
    assert.equal(h.clicks.length,count);assert.equal(h.timers.size,0);
});
// Catches repeated coordination waking search/battery waits before the scheduled callback.
test('quest mine timer respects search and battery waits without replacing unfinished mines', () => {
    const h=setup();let searches=0;
    h.underground.generateMine=()=>{searches++;h.mine.timeUntilDiscovery=5;h.mine.completed=false;h.underground.mine=h.mine;};
    h.underground.mine=null;h.w.initAutoMine();
    const {adapter,token}=leaseMine(h);adapter.apply(token,{});
    assert.equal(searches,1);assert.equal(h.delays.at(-1),1000);
    adapter.apply(token,{});assert.equal(searches,1);assert.deepEqual(h.clicks,[]);
    h.mine.timeUntilDiscovery=0;h.battery.activeDischargeID='Eruption';h.tick();
    assert.equal(h.delays.at(-1),100);assert.deepEqual(h.clicks,[]);
    h.mine.completed=true;h.tick();assert.equal(searches,1);
    h.battery.activeDischargeID=null;h.tick();assert.equal(searches,2);
});
