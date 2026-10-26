const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load } = require('./helpers.cjs');
const file = 'custom/optionalaccelerators.user.js';
const html = '<div id="settingsModal"><div><ul class="nav-tabs"></ul><div class="tab-content"></div></div></div>';
function fixture(options = {}) {
    let ticks = 0;
    let age = 0;
    const nativeUpdate = function (delta) { ticks++; age += delta; return this; };
    const farming = Object.create({ update: nativeUpdate });
    const pokemon = { effortPoints: 0, pokerus: 2 };
    class Egg {
        constructor(ready = true) { this.pokemon = 25; this.ready = ready; }
        hatch(efficiency = 100, helper = false) {
            this.args = [efficiency, helper];
            if (!this.ready) return false;
            if (pokemon.pokerus === 1) pokemon.pokerus = 2;
            return true;
        }
    }
    const nativeHatch = Egg.prototype.hatch;
    const party = { getPokemon: id => id === 25 ? pokemon : undefined,
        calculateEffortPoints: (p, shiny, shadow, ep) => {
            assert.equal(shiny, false); assert.equal(shadow, 0);
            return p.pokerus >= 2 ? ep * 2 : 0;
        } };
    const globals = { App: { isUsingClient: true, game: { farming, party } }, Egg,
        GameConstants: { EP_EV_RATIO: 100, ShadowStatus: { None: 0 } },
        Preload: { hideSplashScreen() {} }, ...options.globals };
    const h = load(file, options.html ?? html, globals, options.storage ?? { optionalaccelerators: true });
    h.w.Preload.hideSplashScreen();
    return { ...h, farming, pokemon, party, Egg, nativeUpdate, nativeHatch,
        ticks: () => ticks, age: () => age, api: h.w.OptionalAccelerators };
}
test('loading enabled script leaves native methods untouched and effects OFF', () => {
    const h = fixture({ storage: { optionalaccelerators: true, optionalFarmSpeed: 10, optionalHatchEV: true } });
    assert.equal(h.farming.update, h.nativeUpdate);
    assert.equal(h.Egg.prototype.hatch, h.nativeHatch);
    assert.equal(h.timers.size, 0);
    assert.equal(h.api.getState().farmSpeed, 1);
    assert.equal(h.api.getState().hatchEV, false);
    assert.match(h.w.document.body.textContent, /progression.*persist/i);
});
test('farm uses bounded full native ticks and fractional speed without changing clock', () => {
    const h = fixture();
    const now = h.w.Date.now;
    for (const [speed, expectedTicks] of [[0.5, 1], [1, 2], [2, 4], [5, 10], [10, 20]]) {
        const before = h.ticks();
        assert.equal(h.api.setFarmSpeed(speed), true);
        h.farming.update(0.1); h.farming.update(0.1);
        assert.equal(h.ticks() - before, expectedTicks);
    }
    assert.ok(Math.abs(h.age() - 3.7) < 1e-9);
    assert.equal(h.w.Date.now, now);
    assert.equal(h.timers.size, 0);
});
test('invalid farm values fail closed to normal speed', () => {
    const h = fixture();
    for (const value of [0, -1, 3, 11, Infinity, NaN, '2', null, undefined]) {
        h.api.setFarmSpeed(10);
        assert.equal(h.api.setFarmSpeed(value), false);
        assert.equal(h.api.getState().farmSpeed, 1);
        assert.equal(h.farming.update, h.nativeUpdate);
    }
});
test('repeated enable never stacks and disable restores inherited method', () => {
    const h = fixture();
    for (let i = 0; i < 3; i++) {
        h.api.setFarmSpeed(2); h.api.setFarmSpeed(2);
        const before = h.ticks(); h.farming.update(0.1);
        assert.equal(h.ticks() - before, 2);
        h.api.setFarmSpeed(1);
        assert.equal(Object.hasOwn(h.farming, 'update'), false);
        assert.equal(h.farming.update, h.nativeUpdate);
    }
});
test('later wrapper survives disable and stale hook stays inert without stacking', () => {
    const h = fixture(); h.api.setFarmSpeed(10);
    const old = h.farming.update;
    const later = function (...args) { return old.apply(this, args); };
    h.farming.update = later;
    h.api.setFarmSpeed(1); h.farming.update(0.1);
    assert.equal(h.ticks(), 1); assert.equal(h.farming.update, later);
    assert.equal(h.api.setFarmSpeed(2), false);
    h.farming.update(0.1); assert.equal(h.ticks(), 2);
});
test('successful hatches award one base EV through native EP rules once per egg', () => {
    const h = fixture(); h.api.setHatchEV(true); h.api.setHatchEV(true);
    const egg = new h.Egg();
    assert.equal(egg.hatch(75, true), true);
    assert.deepEqual(egg.args, [75, true]);
    assert.equal(h.pokemon.effortPoints, 200);
    egg.hatch(); assert.equal(h.pokemon.effortPoints, 200);
    assert.equal(new h.Egg(false).hatch(), false);
    assert.equal(h.pokemon.effortPoints, 200);
    h.api.setHatchEV(false);
    assert.equal(h.Egg.prototype.hatch, h.nativeHatch);
    new h.Egg().hatch(); assert.equal(h.pokemon.effortPoints, 200);
});
test('hatch wrapper preserves native failures, later wrappers and progression on disable', () => {
    const h = fixture(); h.api.setHatchEV(true);
    const old = h.Egg.prototype.hatch;
    const later = function (...args) { return old.apply(this, args); };
    h.Egg.prototype.hatch = later;
    new h.Egg().hatch(); h.api.setHatchEV(false); new h.Egg().hatch();
    assert.equal(h.pokemon.effortPoints, 200);
    assert.equal(h.Egg.prototype.hatch, later);
    assert.equal(h.api.setHatchEV(true), false);
});
test('missing APIs fail closed and no settings host does not affect native game', () => {
    const h = fixture({ html: '' });
    h.farming.update = undefined;
    assert.equal(h.api.setFarmSpeed(2), false);
    h.party.calculateEffortPoints = undefined;
    assert.equal(h.api.setHatchEV(true), false);
    assert.equal(h.api.getState().hatchEV, false);
    assert.equal(h.Egg.prototype.hatch, h.nativeHatch);
});
test('invalid or removed EV API never corrupts native hatch return or effort points', () => {
    const h = fixture(); h.api.setHatchEV(true);
    h.party.calculateEffortPoints = () => NaN;
    assert.equal(new h.Egg().hatch(), true);
    assert.equal(h.pokemon.effortPoints, 0);
    assert.equal(h.api.getState().hatchEV, false);
    h.party.calculateEffortPoints = () => { throw Error('unavailable'); };
    h.api.setHatchEV(true);
    assert.equal(new h.Egg().hatch(), true);
    assert.equal(h.pokemon.effortPoints, 0);
    assert.equal(h.api.getState().hatchEV, false);
});
test('UI controls activate independently and reset both effects', () => {
    const h = fixture();
    const speed = h.w.document.getElementById('optional-accelerators-farm');
    speed.value = '5'; speed.dispatchEvent(new h.w.Event('change'));
    assert.equal(h.api.getState().farmSpeed, 5);
    const ev = h.w.document.getElementById('optional-accelerators-ev'); ev.click();
    assert.equal(h.api.getState().hatchEV, true);
    h.w.document.getElementById('optional-accelerators-reset').click();
    assert.equal(h.api.getState().farmSpeed, 1);
    assert.equal(h.api.getState().hatchEV, false);
    assert.equal(h.farming.update, h.nativeUpdate);
    assert.equal(h.Egg.prototype.hatch, h.nativeHatch);
});
test('desktop gate does not install anything until script explicitly enabled', () => {
    const h = fixture({ storage: {} });
    assert.equal(h.api, undefined);
    assert.equal(h.farming.update, h.nativeUpdate);
    assert.equal(h.Egg.prototype.hatch, h.nativeHatch);
});

test('Pokérus eligibility is native and infection upgrade precedes the EV reward', () => {
    const h = fixture(); h.api.setHatchEV(true);
    h.pokemon.pokerus = 0; new h.Egg().hatch();
    assert.equal(h.pokemon.effortPoints, 0);
    h.pokemon.pokerus = 1; new h.Egg().hatch();
    assert.equal(h.pokemon.effortPoints, 200);
});
test('native hatch exception propagates without awarding a bonus', () => {
    const h = fixture();
    h.Egg.prototype.hatch = () => { throw Error('native failure'); };
    h.api.setHatchEV(true);
    assert.throws(() => new h.Egg().hatch(), /native failure/);
    assert.equal(h.pokemon.effortPoints, 0);
});
test('reload starts OFF even after both effects were active', () => {
    const h = fixture(); h.api.setFarmSpeed(10); h.api.setHatchEV(true);
    const storage = Object.fromEntries(Object.keys(h.w.localStorage).map(key => [key, JSON.parse(h.w.localStorage.getItem(key))]));
    const fresh = fixture({ storage });
    assert.equal(fresh.api.getState().farmSpeed, 1);
    assert.equal(fresh.api.getState().hatchEV, false);
    assert.equal(fresh.farming.update, fresh.nativeUpdate);
    assert.equal(fresh.Egg.prototype.hatch, fresh.nativeHatch);
});
test('duplicate script loading and initialization neither duplicates UI nor resets active state', () => {
    const h = fixture(); h.api.setFarmSpeed(2);
    h.run(fs.readFileSync(require('node:path').join(__dirname, '..', file), 'utf8'));
    h.w.epheniaScriptInitializers.optionalaccelerators();
    assert.equal(h.w.document.querySelectorAll('#optional-accelerators-panel').length, 1);
    assert.equal(h.api.getState().farmSpeed, 2);
    h.farming.update(0.1); assert.equal(h.ticks(), 2);
});
test('browser mode uses the page window and does not require desktop opt-in', () => {
    const page = {};
    fixture({ storage: {}, globals: { App: { isUsingClient: false, game: {} }, unsafeWindow: page } });
    assert.equal(page.OptionalAccelerators.getState().farmSpeed, 1);
    assert.equal(page.OptionalAccelerators.getState().hatchEV, false);
});
test('a pre-existing farm wrapper keeps its receiver, arguments and return value', () => {
    const h = fixture();
    const prior = function (delta, marker) { assert.equal(this, h.farming); assert.equal(marker, 'marker'); return h.nativeUpdate.call(this, delta); };
    h.farming.update = prior; h.api.setFarmSpeed(2);
    assert.equal(h.farming.update(0.1, 'marker'), h.farming);
    assert.equal(h.ticks(), 2);
    h.api.reset(); assert.equal(h.farming.update, prior);
});
test('invalid hatch option values disable a previously enabled effect', () => {
    const h = fixture();
    for (const value of [1, 'true', null, undefined]) {
        h.api.setHatchEV(true);
        assert.equal(h.api.setHatchEV(value), false);
        assert.equal(h.api.getState().hatchEV, false);
        assert.equal(h.Egg.prototype.hatch, h.nativeHatch);
    }
});
function routeFixture() {
    const h = fixture();
    let calls = 0;
    let attacks = 0;
    let alive = true;
    let catching = false;
    const battle = { counter: 0, catching: () => catching, enemyPokemon: () => ({ isAlive: () => alive }) };
    Object.assign(h.w.GameConstants, { TICK_TIME: 100, BATTLE_TICK: 1000, GameState: { fighting: 1, gym: 2, town: 3 } });
    h.w.Battle = battle;
    const game = h.w.App.game;
    game.gameState = 1;
    const nativeTick = function (marker) {
        assert.equal(this, game);
        calls++;
        if (this.gameState === 1) {
            battle.counter += 100;
            if (battle.counter >= 1000) {
                battle.counter = 0;
                if (alive && !catching) attacks++;
            }
        }
        return marker;
    };
    Object.setPrototypeOf(game, { gameTick: nativeTick });
    return { ...h, game, battle, nativeTick, calls: () => calls, attacks: () => attacks,
        alive: value => { alive = value; }, catching: value => { catching = value; } };
}
test('route attacks are OFF on reload and 2x cadence changes no global timing or tick counts', () => {
    const h = routeFixture(); const now = h.w.Date.now;
    assert.equal(h.api.getState().routeAttack, false);
    assert.equal(h.game.gameTick, h.nativeTick);
    for (let i = 0; i < 10; i++) h.game.gameTick();
    assert.equal(h.attacks(), 1);
    assert.equal(h.api.setRouteAttack(true), true);
    for (let i = 0; i < 10; i++) assert.equal(h.game.gameTick('marker'), 'marker');
    assert.equal(h.attacks(), 3); assert.equal(h.calls(), 20);
    assert.equal(h.w.Date.now, now); assert.equal(h.w.GameConstants.BATTLE_TICK, 1000); assert.equal(h.timers.size, 0);
});
test('route acceleration ignores gym/town, dead enemies and capture waits', () => {
    const h = routeFixture(); h.api.setRouteAttack(true);
    for (const state of [2, 3]) { h.game.gameState = state; h.game.gameTick(); assert.equal(h.battle.counter, 0); }
    h.game.gameState = 1; h.alive(false); h.game.gameTick(); assert.equal(h.battle.counter, 100);
    h.alive(true); h.catching(true); h.game.gameTick(); assert.equal(h.battle.counter, 200);
    h.catching(false); h.battle.enemyPokemon = () => null; h.game.gameTick(); assert.equal(h.battle.counter, 300);
    assert.equal(h.calls(), 5); assert.equal(h.attacks(), 0);
});
test('route disable and repeated re-enable restore native method without stacking', () => {
    const h = routeFixture();
    for (let i = 0; i < 3; i++) {
        assert.equal(h.api.setRouteAttack(true), true); assert.equal(h.api.setRouteAttack(true), true);
        h.battle.counter = 0; h.game.gameTick(); assert.equal(h.battle.counter, 200);
        h.api.setRouteAttack(false); assert.equal(Object.hasOwn(h.game, 'gameTick'), false);
        assert.equal(h.game.gameTick, h.nativeTick); h.game.gameTick(); assert.equal(h.battle.counter, 300);
    }
    assert.equal(h.calls(), 6);
});
test('route invalid options and missing APIs fail closed and preserve native ticks', () => {
    const h = routeFixture();
    for (const value of [1, 'true', null, undefined]) {
        h.api.setRouteAttack(true); assert.equal(h.api.setRouteAttack(value), false);
        assert.equal(h.api.getState().routeAttack, false); assert.equal(h.game.gameTick, h.nativeTick);
    }
    h.battle.catching = undefined; assert.equal(h.api.setRouteAttack(true), false);
    h.battle.catching = () => false; h.w.GameConstants.TICK_TIME = Infinity; assert.equal(h.api.setRouteAttack(true), false);
    h.w.GameConstants.TICK_TIME = 100; h.api.setRouteAttack(true);
    h.battle.enemyPokemon = () => { throw Error('invalid enemy API'); };
    h.game.gameTick(); assert.equal(h.calls(), 1); assert.equal(h.battle.counter, 100);
    assert.equal(h.api.getState().routeAttack, false); assert.equal(h.game.gameTick, h.nativeTick);
});
test('route hook does not mask native failure or overwrite a later wrapper', () => {
    const h = routeFixture();
    const failure = () => { throw Error('native failure'); }; h.game.gameTick = failure;
    h.api.setRouteAttack(true); assert.throws(() => h.game.gameTick(), /native failure/);
    h.api.setRouteAttack(false); assert.equal(h.game.gameTick, failure);
    h.game.gameTick = h.nativeTick; h.api.setRouteAttack(true);
    const old = h.game.gameTick; const later = function (...args) { return old.apply(this, args); };
    h.game.gameTick = later; h.api.setRouteAttack(false); h.battle.counter = 0;
    h.game.gameTick(); assert.equal(h.battle.counter, 100); assert.equal(h.game.gameTick, later);
    assert.equal(h.api.setRouteAttack(true), false); h.game.gameTick(); assert.equal(h.battle.counter, 200);
});
test('route checkbox is explicit and reset turns all effects OFF', () => {
    const h = routeFixture(); const toggle = h.w.document.getElementById('optional-accelerators-route-attack');
    assert.equal(toggle.checked, false); toggle.click(); assert.equal(h.api.getState().routeAttack, true);
    h.api.setFarmSpeed(2); h.api.setHatchEV(true); h.api.reset();
    assert.equal(toggle.checked, false); assert.equal(h.api.getState().routeAttack, false);
    assert.equal(h.game.gameTick, h.nativeTick); assert.equal(h.api.getState().farmSpeed, 1); assert.equal(h.api.getState().hatchEV, false);
});
