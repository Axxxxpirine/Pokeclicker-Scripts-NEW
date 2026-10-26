const test = require('node:test');
const assert = require('node:assert/strict');
const { load, observable } = require('./helpers.cjs');
function cafe(options = {}) {
    const rewards = [];
    const berries = [observable(options.berries ?? 50), observable(50)];
    const DayCycle = { currentDayCyclePart: () => 0 };
    class BattleCafe { isUnlocked() { return !options.lockedCafe; } }
    const controller = {
        selectedSweet: observable(0), spinsLeft: observable(options.spins ?? 5),
        isSpinning: observable(false), clockwise: observable(false),
        evolutions: { 0: {}, 1: {} },
        getPrice: sweet => [{ berry: 0, amount: sweet === 0 ? 10 : 20 }, { berry: 1, amount: 5 }],
        unlockAlcremie(clockwise, seconds, sweet) {
            rewards.push({ clockwise, seconds, sweet, part: DayCycle.currentDayCyclePart() });
            if (options.error) throw Error('Reward failed');
            return { getPokerusStatus: () => options.resistant ? 3 : 0 };
        },
    };
    const h = load('custom/optionalbattlecafe.user.js', '<div id="battleCafeModal"><div class="modal-body"></div></div>', {
        BattleCafe, BattleCafeController: controller, DayCycle,
        DayCyclePart: { Dawn: 0, Day: 1, Dusk: 2, Night: 3 },
        GameConstants: { AlcremieSweet: { 'Strawberry Sweet': 0, 'Love Sweet': 1, 0: 'Strawberry Sweet', 1: 'Love Sweet' }, Pokerus: { Resistant: 3 } },
        TownList: { Motostoke: { isUnlocked: () => !options.lockedTown, content: [new BattleCafe()] } },
        App: { isUsingClient: true, game: { farming: { berryInventory: berries } } },
    });
    h.w.initOptionalBattleCafe();
    return { ...h, rewards, berries, controller, DayCycle, button: id => h.w.document.getElementById(`optional-cafe-${id}`), start(config = {}) { return h.w.OptionalBattleCafe.start({ sweet: 0, recipe: 'vanilla', count: 2, day: 'current', ...config }); } };
}
test('cafe is OFF on load with no resources, hooks or timers changed', () => {
    const h = cafe(); assert.equal(h.timers.size, 0); assert.equal(h.controller.spinsLeft(), 5);
    assert.equal(h.berries[0](), 50); assert.match(h.button('status').textContent, /OFF/);
    assert.equal(h.button('day').value, 'current'); assert.equal(h.button('stop').disabled, true);
});
test('bounded accelerated recipe pays all berry costs and completes without timers', () => {
    const h = cafe(); h.start({ recipe: 'cheese' }); h.tick(); h.tick(); h.tick();
    assert.equal(h.rewards.length, 2); assert.equal(h.rewards[0].seconds, 3600);
    assert.equal(h.berries[0](), 30); assert.equal(h.berries[1](), 40); assert.equal(h.controller.spinsLeft(), 3);
    assert.equal(h.timers.size, 0); assert.equal(h.controller.isSpinning(), false);
});
test('costs checked before each iteration, shortage stops without free reward', () => {
    const h = cafe({ berries: 15 }); h.start(); h.tick(); h.tick();
    assert.equal(h.rewards.length, 1); assert.equal(h.berries[0](), 5); assert.equal(h.berries[1](), 45); assert.equal(h.timers.size, 0);
});
test('stop cancels pending action without refunding completed spins', () => {
    const h = cafe(); h.start(); h.tick(); h.button('stop').click(); h.tick();
    assert.equal(h.rewards.length, 1); assert.equal(h.berries[0](), 40); assert.equal(h.controller.spinsLeft(), 4); assert.equal(h.timers.size, 0);
});
test('rejects invalid counts, sweets, recipes and day modes before spending', () => {
    const h = cafe();
    for (const count of ['', 0, -1, 1.5, 101, Infinity, NaN, null]) assert.equal(h.start({ count }), false);
    for (const config of [{ sweet: 99 }, { recipe: 'oops' }, { day: 'oops' }]) assert.equal(h.start(config), false);
    assert.equal(h.timers.size, 0); assert.equal(h.berries[0](), 50);
});
test('day override applies only during native reward and restores exact function', () => {
    const h = cafe(); const original = h.DayCycle.currentDayCyclePart; const DateOriginal = h.w.Date;
    h.start({ day: 'Dusk', recipe: 'rainbow', count: 1 }); assert.equal(h.DayCycle.currentDayCyclePart, original); h.tick();
    assert.equal(h.rewards[0].part, 2); assert.equal(h.rewards[0].clockwise, false); assert.equal(h.rewards[0].seconds, 11);
    assert.equal(h.DayCycle.currentDayCyclePart, original); assert.equal(h.w.Date, DateOriginal);
});
test('reward failure restores day and busy flag without resource refund or retry', () => {
    const h = cafe({ error: true }); const original = h.DayCycle.currentDayCyclePart;
    h.start({ day: 'Night' }); h.tick(); h.tick();
    assert.equal(h.rewards.length, 1); assert.equal(h.berries[0](), 40); assert.equal(h.controller.spinsLeft(), 4);
    assert.equal(h.DayCycle.currentDayCyclePart, original); assert.equal(h.controller.isSpinning(), false); assert.equal(h.timers.size, 0);
});
test('native spin in progress prevents start or later automated iteration', () => {
    const h = cafe(); h.controller.isSpinning(true); assert.equal(h.start(), false);
    h.controller.isSpinning(false); h.start(); h.controller.isSpinning(true); h.tick();
    assert.equal(h.rewards.length, 0); assert.equal(h.controller.isSpinning(), true); assert.equal(h.berries[0](), 50); assert.equal(h.timers.size, 0);
});
test('unlocked town and cafe are required for spins and added credits', () => {
    for (const options of [{ lockedTown: true }, { lockedCafe: true }]) {
        const h = cafe(options); assert.equal(h.start(), false); assert.equal(h.w.OptionalBattleCafe.addSpins(3), false);
        assert.equal(h.controller.spinsLeft(), 5); assert.equal(h.timers.size, 0);
    }
});
test('finite extra spins are explicit, validate quantity, never mint berries', () => {
    const h = cafe({ spins: 0 }); assert.equal(h.start(), false);
    for (const n of ['', 0, -1, 101, Infinity, 1.1, null]) assert.equal(h.w.OptionalBattleCafe.addSpins(n), false);
    h.button('extra-count').value = '3'; h.button('add').click();
    assert.equal(h.controller.spinsLeft(), 3); assert.equal(h.berries[0](), 50);
    h.start({ count: 5 }); for (let i = 0; i < 6; i++) h.tick();
    assert.equal(h.rewards.length, 3); assert.equal(h.controller.spinsLeft(), 0); assert.equal(h.timers.size, 0);
});
test('resistant reward preserves native daily-spin exemption but still pays berries', () => {
    const h = cafe({ resistant: true, spins: 1 }); h.start(); h.tick(); h.tick();
    assert.equal(h.rewards.length, 2); assert.equal(h.controller.spinsLeft(), 1); assert.equal(h.berries[0](), 30);
});
test('UI start snapshots selected sweet and recipe and repeated init has one panel', () => {
    const h = cafe(); h.w.initOptionalBattleCafe();
    assert.equal(h.w.document.querySelectorAll('#optional-cafe-panel').length, 1);
    h.button('sweet').value = '1'; h.button('recipe').value = 'caramel'; h.button('count').value = '1'; h.button('start').click();
    h.button('sweet').value = '0'; h.tick();
    assert.equal(h.rewards[0].sweet, 1); assert.equal(h.rewards[0].seconds, 5); assert.equal(h.berries[0](), 30);
});
test('missing globals leave safe disabled controls and no timers', () => {
    const h = load('custom/optionalbattlecafe.user.js', '<div id="battleCafeModal"><div class="modal-body"></div></div>');
    assert.doesNotThrow(() => h.w.initOptionalBattleCafe()); assert.equal(h.w.OptionalBattleCafe.start({ sweet: 0, recipe: 'vanilla', count: 1, day: 'current' }), false); assert.equal(h.timers.size, 0);
});
test('maximum batch stays bounded even when resistant rewards never consume a spin', () => {
    const h = cafe({ resistant: true, spins: 1, berries: 2000 }); h.berries[1](1000);
    assert.equal(h.start({ count: 100 }), true);
    for (let i = 0; i < 105; i++) h.tick();
    assert.equal(h.rewards.length, 100); assert.equal(h.berries[0](), 1000); assert.equal(h.berries[1](), 500); assert.equal(h.timers.size, 0);
});
test('pagehide cancels a pending batch before payment', () => {
    const h = cafe(); h.start(); h.w.dispatchEvent(new h.w.Event('pagehide')); h.tick();
    assert.equal(h.rewards.length, 0); assert.equal(h.berries[0](), 50); assert.equal(h.timers.size, 0);
});
test('unlock and inventory are rechecked after the batch is started', () => {
    const options = {}; const h = cafe(options); h.start(); options.lockedCafe = true; h.tick();
    assert.equal(h.rewards.length, 0); assert.equal(h.berries[0](), 50); assert.equal(h.timers.size, 0);
});
test('desktop gate registers initializer only after explicitly enabling the script', () => {
    const disabled = load('custom/optionalbattlecafe.user.js'); assert.equal(disabled.w.epheniaScriptInitializers, undefined);
    const enabled = load('custom/optionalbattlecafe.user.js', '', { Preload: { hideSplashScreen() {} } }, { optionalbattlecafe: true });
    assert.equal(typeof enabled.w.epheniaScriptInitializers.optionalbattlecafe, 'function'); assert.equal(enabled.timers.size, 0);
});
test('reloading never resumes a batch or restores a time override', () => {
    const h = cafe(); h.start({ day: 'Night' });
    const next = cafe(); next.tick();
    assert.equal(next.rewards.length, 0); assert.equal(next.timers.size, 0); assert.equal(next.button('day').value, 'current');
    h.w.OptionalBattleCafe.stop();
});
test('initializer exposes controller from userscript private scope for console and integrations', () => {
    const h = cafe();
    const fs = require('node:fs'); const path = require('node:path');
    const source = fs.readFileSync(path.join(__dirname, '../custom/optionalbattlecafe.user.js'), 'utf8');
    h.w.OptionalBattleCafe = undefined;
    h.run(`(() => { ${source}\ninitOptionalBattleCafe(); })()`);
    assert.equal(typeof h.w.OptionalBattleCafe?.start, 'function');
    assert.equal(h.w.document.querySelectorAll('#optional-cafe-panel').length, 1);
});
