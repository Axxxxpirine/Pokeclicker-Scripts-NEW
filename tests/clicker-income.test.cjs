const test = require('node:test');
const assert = require('node:assert/strict');
const { load, observable } = require('./helpers.cjs');

function setup(t) {
    const statistics = {
        clickAttacks: observable(100), totalPokemonDefeated: observable(50),
        totalMoney: observable(10000), totalDungeonTokens: observable(2000),
    };
    const wallet = { currencies: [observable(500), observable(100)] };
    const c = load('enhancedautoclicker.user.js', '<div id="auto-click-info"></div>', {
        ko: { observable, pureComputed: fn => fn }, baseLootTierChance: {},
        App: { isUsingClient: true, game: { statistics, wallet, gameState: 0, party: { calculateClickAttack: () => 10 } } },
        GameConstants: { GameState: { fighting: 1, gym: 2, dungeon: 3, temporaryBattle: 4 } },
        player: { route: 0, town: { name: 'Pallet Town' } },
    });
    t.after(() => c.dom.window.close());
    let now = 1000;
    c.w.Date.now = () => now;
    const clicker = c.run('EnhancedAutoClicker');
    clicker.autoClickState(true);
    clicker.hasPlayerMoved();
    clicker.resetCalculator();
    return {
        ...c, clicker, statistics, wallet,
        advance(ms, money = 0, tokens = 0) {
            now += ms;
            statistics.totalMoney(statistics.totalMoney() + money);
            statistics.totalDungeonTokens(statistics.totalDungeonTokens() + tokens);
            c.tick();
        },
        value(id) { return c.w.document.getElementById(id)?.textContent; },
    };
}

test('income rates measure gross earnings over actual elapsed time despite spending', t => {
    const c = setup(t);
    assert.equal(c.value('money-per-second'), '-');
    c.wallet.currencies[0](0);
    c.wallet.currencies[1](0);
    c.advance(2500, 250, 50);
    assert.equal(c.value('money-per-second'), '100');
    assert.equal(c.value('dungeon-tokens-per-second'), '20');
    c.advance(2500);
    assert.equal(c.value('money-per-second'), '50');
    assert.equal(c.value('dungeon-tokens-per-second'), '10');
});

test('income rates discard old rewards after ten samples and fall to zero when idle', t => {
    const c = setup(t);
    c.advance(1000, 1000, 100);
    for (let i = 0; i < 9; i++) c.advance(1000);
    assert.equal(c.value('money-per-second'), '100');
    assert.equal(c.value('dungeon-tokens-per-second'), '10');
    c.advance(1000);
    assert.equal(c.value('money-per-second'), '0');
    assert.equal(c.value('dungeon-tokens-per-second'), '0');
});

test('changing locations starts a fresh income baseline', t => {
    const c = setup(t);
    c.advance(1000, 300, 60);
    c.w.player.town.name = 'Viridian City';
    c.advance(1000, 1000, 1000);
    assert.equal(c.value('money-per-second'), '-');
    assert.equal(c.value('dungeon-tokens-per-second'), '-');
    c.advance(1000, 20, 5);
    assert.equal(c.value('money-per-second'), '20');
    assert.equal(c.value('dungeon-tokens-per-second'), '5');
});

test('stopping and restarting the calculator excludes earnings while stopped', t => {
    const c = setup(t);
    c.advance(1000, 100, 10);
    c.clicker.autoClickState(false);
    c.clicker.resetCalculator();
    c.advance(20000, 50000, 5000);
    assert.equal(c.value('money-per-second'), '-');
    assert.equal(c.timers.size, 0);
    c.clicker.autoClickState(true);
    c.clicker.resetCalculator();
    c.advance(1000, 12, 3);
    assert.equal(c.value('money-per-second'), '12');
    assert.equal(c.value('dungeon-tokens-per-second'), '3');
    assert.equal(c.timers.size, 1);
});

test('zero elapsed time and decreased lifetime totals never display invalid or negative income', t => {
    const c = setup(t);
    c.advance(0);
    assert.equal(c.value('money-per-second'), '0');
    assert.equal(c.value('dungeon-tokens-per-second'), '0');
    c.advance(1000, -10000, -2000);
    assert.equal(c.value('money-per-second'), '0');
    assert.equal(c.value('dungeon-tokens-per-second'), '0');
});
