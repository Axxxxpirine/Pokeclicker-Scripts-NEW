const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { load, observable, Currency } = require('./helpers.cjs');

// Separate worker and window clocks: hidden windows can stop delivering timers.
function setup(t, workerFailure = false) {
    const workers = [], blobs = new Map();
    let attacks = 0, entries = 0, now = 0;
    class Blob { constructor(parts) { this.source = parts.join(''); } }
    class Worker {
        constructor(url) {
            if (workerFailure) throw new Error('Worker blocked');
            this.stopped = false;
            this.pending = [];
            this.scope = { setInterval: fn => { this.timer = fn; },
                performance: {timeOrigin: 1000, now: () => now - 1000},
                postMessage: data => this.pending.push(data) };
            this.scope.self = this.scope;
            vm.runInNewContext(blobs.get(url).source, this.scope);
            workers.push(this);
        }
        postMessage(data) { this.scope.onmessage?.({data}); }
        pulse() { now += 50; this.timer(); }
        terminate() { this.stopped = true; }
        flush() { for (const data of this.pending.splice(0)) this.onmessage?.({data}); }
        tick() { if (!this.stopped) this.pulse(); this.flush(); }
    }
    const dungeon = {isUnlocked: () => true, tokenCost: 1};
    class DungeonTown { constructor() { this.dungeon = dungeon; } }
    const h = load('enhancedautoclicker.user.js', '', {
        ko: {observable, pureComputed: fn => fn}, baseLootTierChance: {common: 1},
        Blob, Worker, URL: {createObjectURL: blob => { const url = `blob:${blobs.size}`; blobs.set(url, blob); return url; }, revokeObjectURL: url => blobs.delete(url)},
        GameConstants: {Currency, GameState: {fighting: 0, town: 1, dungeon: 2}},
        App: {isUsingClient: true, game: {gameState: 0, wallet: {hasAmount: () => true}}},
        Battle: {clickAttack: () => attacks++}, DungeonTown, player: {town: new DungeonTown()},
        DungeonGuides: {hired: () => false}, Amount: class {},
        DungeonRunner: {initializeDungeon: () => entries++},
    });
    t.after(() => h.dom.window.close());
    h.w.performance.now = () => now;
    Object.defineProperty(h.w.performance, 'timeOrigin', {value: 0});
    const c = h.run('EnhancedAutoClicker');
    // Combat overrides and statistics have their own coverage. Exercise real dispatch.
    c.overrideClickAttack = () => {};
    c.resetCalculator = () => {};
    c.autoClickCalcTracker.ticks = [0];
    c.autoClickState(true);
    return {...h, c, workers, blobs, advance: ms => { now += ms; }, attacks: () => attacks, entries: () => entries};
}

test('hidden tab keeps attacking and entering dungeons without window timer delivery', t => {
    const h = setup(t);
    Object.defineProperty(h.w.document, 'hidden', {value: true, configurable: true});
    h.c.toggleAutoClickerLoop();
    for (let i = 0; i < 20; i++) h.workers.at(-1)?.tick();
    assert.equal(h.attacks(), 20);
    h.w.App.game.gameState = 1;
    h.c.autoDungeonState(true);
    h.workers.at(-1).tick();
    assert.equal(h.entries(), 1);
    Object.defineProperty(h.w.document, 'hidden', {value: false});
    h.tick();
    h.workers.at(-1).tick();
    assert.equal(h.entries(), 2, 'returning to the tab must not add a second clock');
});

test('worker does not accumulate catch-up attacks while the page is blocked', t => {
    const h = setup(t);
    h.c.toggleAutoClickerLoop();
    const worker = h.workers.at(-1);
    assert.ok(worker, 'background clock is available');
    for (let i = 0; i < 100; i++) worker.pulse();
    worker.flush();
    assert.equal(h.attacks(), 1);
    worker.tick();
    assert.equal(h.attacks(), 2);
});

test('cadence does not depend on acknowledgement delivery to a background worker', t => {
    const h = setup(t);
    h.c.toggleAutoClickerLoop();
    const worker = h.workers.at(-1);
    worker.postMessage = () => {}; // Background return path is delayed.
    for (let i = 0; i < 20; i++) worker.tick();
    assert.equal(h.attacks(), 20);
});

test('an expired tick performs no action and a fresh tick resumes normally', t => {
    const h = setup(t);
    h.c.toggleAutoClickerLoop();
    const worker = h.workers.at(-1);
    worker.pulse();
    h.advance(500);
    worker.flush();
    assert.equal(h.attacks(), 0);
    worker.tick();
    assert.equal(h.attacks(), 1);
});

test('restart and stop ignore queued messages from obsolete workers', t => {
    const h = setup(t);
    h.c.toggleAutoClickerLoop();
    const old = h.workers.at(-1);
    assert.ok(old);
    old.pulse();
    h.c.toggleAutoClickerLoop();
    old.flush();
    h.workers.at(-1).tick();
    assert.equal(h.attacks(), 1);
    const current = h.workers.at(-1);
    current.pulse();
    h.c.autoClickState(false);
    h.c.toggleAutoClickerLoop();
    current.flush();
    assert.equal(h.attacks(), 1);
    assert.ok(h.workers.every(worker => worker.stopped));
    assert.equal(h.blobs.size, 0, 'temporary worker URLs are released');
});

test('blocked worker falls back to ordinary timers and stops cleanly', t => {
    const h = setup(t, true);
    h.c.toggleAutoClickerLoop();
    h.tick();
    assert.equal(h.attacks(), 1);
    h.c.autoClickState(false);
    h.c.toggleAutoClickerLoop();
    h.tick();
    assert.equal(h.attacks(), 1);
    assert.equal(h.blobs.size, 0);
});

test('asynchronous worker failure falls back once and rejects late messages', t => {
    const h = setup(t);
    h.c.toggleAutoClickerLoop();
    const worker = h.workers.at(-1);
    assert.ok(worker);
    worker.pulse();
    worker.onerror({preventDefault() {}});
    worker.onerror({preventDefault() {}});
    worker.flush();
    h.tick();
    assert.equal(h.attacks(), 1);
    assert.equal(worker.stopped, true);
});
