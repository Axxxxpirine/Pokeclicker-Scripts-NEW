const test = require('node:test');
const assert = require('node:assert/strict');
const { load, observable, Currency } = require('./helpers.cjs');

function setup(t, storage = {}) {
    const caught = new Set(['Pidgey']);
    const dungeon = { name: 'Forest', tokenCost: 10, isUnlocked: () => true,
        allAvailablePokemon: () => ['Pidgey', 'Pikachu'], rewardFunction() {} };
    class DungeonTown { constructor() { this.dungeon = dungeon; this.name = dungeon.name; } }
    let entries = 0, exits = 0;
    const game = { gameState: 0, party: { alreadyCaughtPokemonByName: (name, shiny) => !shiny && caught.has(name) },
        wallet: { hasAmount: () => true }, statistics: { dungeonsCleared: [observable(1)] } };
    const runner = { dungeon, fighting: observable(false), dungeonFinished: observable(false),
        initializeDungeon() { entries++; }, dungeonWon() {}, hasEnoughTokens: () => true,
        map: { board() {}, playerPosition: () => ({floor: 0}) } };
    const c = load('enhancedautoclicker.user.js', '<div class="battle-view"></div>', {
        ko: { observable, pureComputed: fn => fn }, baseLootTierChance: {common: 1},
        App: { isUsingClient: true, game }, player: {town: new DungeonTown()}, DungeonTown,
        DungeonRunner: runner, DungeonBattle: { catching: observable(false) }, DungeonGuides: {hired: () => false},
        GameConstants: {GameState: {town: 0, dungeon: 1}, Currency, getDungeonIndex: () => 0},
        Amount: class Amount {}, GameHelper: {incrementObservable: o => o(o() + 1)},
        MapHelper: {moveToTown() { exits++; game.gameState = 0; }},
        Notifier: {notify() {}}, NotificationConstants: {NotificationOption: {success: 'success', warning: 'warning'}},
    }, storage);
    t.after(() => c.dom.window.close());
    const clicker = c.run('EnhancedAutoClicker');
    c.run('createScriptSettingsContainer = () => document.body.appendChild(document.createElement("tbody"))');
    clicker.resetCalculator = () => {};
    clicker.toggleAutoClickerLoop = () => {};
    clicker.initAutoClicker();
    clicker.autoClickState(true);
    clicker.autoDungeonState(true);
    clicker.overrideDungeonRunner();
    // Keep traversal outside these lifecycle tests.
    clicker.autoDungeonTracker.ID = runner.dungeonID;
    clicker.autoDungeonTracker.floor = 0;
    clicker.autoDungeonTracker.dungeonFinished = true;
    return {...c, clicker, caught, dungeon, game, runner, entries: () => entries, exits: () => exits};
}

test('collection stop button persists its setting and restores it on reload', t => {
    const c = setup(t);
    const button = c.w.document.getElementById('auto-dungeon-stop-when-caught');
    assert.ok(button, 'collection stop control exists');
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    button.click();
    assert.equal(c.w.localStorage.getItem('autoDungeonStopWhenCaught'), 'true');
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    const restored = setup(t, {autoDungeonStopWhenCaught: true});
    assert.equal(restored.w.document.getElementById(button.id).getAttribute('aria-pressed'), 'true');
    button.click();
    assert.equal(c.w.localStorage.getItem('autoDungeonStopWhenCaught'), 'false');
});

test('completed collection stops before paying for an entry', t => {
    const c = setup(t, {autoDungeonStopWhenCaught: true});
    c.caught.add('Pikachu');
    c.clicker.autoDungeon();
    assert.equal(c.entries(), 0);
    assert.equal(c.clicker.autoDungeonState(), false);
    assert.equal(c.w.localStorage.getItem('autoDungeonState'), 'false');
});

test('missing boss keeps running, and the default OFF setting allows repeats', t => {
    const c = setup(t, {autoDungeonStopWhenCaught: true});
    c.clicker.autoDungeon();
    assert.equal(c.entries(), 1);
    c.caught.add('Pikachu');
    c.clicker.autoDungeonStopWhenCaught = false;
    c.clicker.autoDungeon();
    assert.equal(c.entries(), 2);
});

test('last normal capture finishes the paid run then stops without another entry', t => {
    const c = setup(t, {autoDungeonStopWhenCaught: true});
    c.game.gameState = 1;
    c.caught.add('Pikachu');
    c.clicker.autoDungeon();
    assert.equal(c.clicker.autoDungeonTracker.stopAfterFinishing, true);
    c.clicker.autoDungeon();
    assert.equal(c.clicker.autoDungeonState(), true, 'pending finish must not toggle repeatedly');
    c.runner.dungeonWon();
    c.tick();
    assert.equal(c.clicker.autoDungeonState(), false);
    assert.equal(c.entries(), 0);
    assert.equal(c.exits(), 1);
});

test('last boss capture stops directly in the victory callback', t => {
    const c = setup(t, {autoDungeonStopWhenCaught: true});
    c.game.gameState = 1;
    c.caught.add('Pikachu');
    c.runner.dungeonWon();
    c.tick();
    assert.equal(c.clicker.autoDungeonState(), false);
    assert.equal(c.entries(), 0);
    assert.equal(c.game.statistics.dungeonsCleared[0](), 2);
});

test('failed final capture still restarts the dungeon', t => {
    const c = setup(t, {autoDungeonStopWhenCaught: true});
    c.game.gameState = 1;
    c.runner.dungeonWon();
    c.tick();
    assert.equal(c.entries(), 1);
    assert.equal(c.clicker.autoDungeonState(), true);
});

for (const reason of ['completed collection', 'manual stop']) {
    test(`delayed restart rechecks ${reason} before spending tokens`, t => {
        const c = setup(t, {autoDungeonStopWhenCaught: true});
        c.game.gameState = 1;
        c.runner.dungeonWon();
        if (reason === 'manual stop') c.clicker.toggleAutoDungeon();
        else c.caught.add('Pikachu');
        c.tick();
        assert.equal(c.entries(), 0);
        assert.equal(c.exits(), 1);
        assert.equal(c.clicker.autoDungeonState(), false);
    });
}

test('immediate stop preference waits for capture to resolve', t => {
    const c = setup(t, {autoDungeonStopWhenCaught: true, autoDungeonFinishBeforeStopping: false});
    c.game.gameState = 1;
    c.caught.add('Pikachu');
    c.w.DungeonBattle.catching(true);
    c.clicker.autoDungeon();
    assert.equal(c.clicker.autoDungeonState(), true);
    c.w.DungeonBattle.catching(false);
    c.clicker.autoDungeon();
    assert.equal(c.clicker.autoDungeonState(), false);
});

test('external navigation retains control even with the collection option enabled', t => {
    const c = setup(t, {autoDungeonStopWhenCaught: true});
    c.caught.add('Pikachu');
    c.clicker.autoDungeonState(false);
    c.clicker.navigationOwner = {active: true, internal: true, stop() {assert.fail('must not stop navigation');}};
    c.clicker.autoDungeon();
    assert.equal(c.entries(), 1);
});

test('empty encounter lists do not signal a completed collection', t => {
    const c = setup(t, {autoDungeonStopWhenCaught: true});
    c.dungeon.allAvailablePokemon = () => [];
    c.clicker.autoDungeon();
    assert.equal(c.entries(), 1);
});
