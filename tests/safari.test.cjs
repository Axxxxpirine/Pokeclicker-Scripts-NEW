const test = require('node:test');
const assert = require('node:assert/strict');
const { load, observable } = require('./helpers.cjs');
function safari({ grid = [[1, 1]], position = { x: 0, y: 0 }, battle = false, storage = {} } = {}) {
    const actions = [];
    const Safari = { grid, playerXY: position, pokemonGrid: () => [], itemGrid: () => [], isMoving: false, moveSpeed: 250, inProgress: () => true, inBattle: () => battle, activeRegion: () => 0, balls: () => 10, step: dir => actions.push(dir) };
    const baits = { Bait: { type: 0 }, Razz: { type: 1 }, Pinap: { type: 2 }, Nanab: { type: 3 } };
    const enemy = { id: 1, name: 'Ditto (Magikarp)', shiny: false, angry: 0, eating: 0, eatingBait: 0, catchFactor: 5, levelModifier: 0 };
    const SafariBattle = { Speed: {}, busy: () => false, enemy, selectedBait: observable(baits.Bait), throwBait: () => { actions.push(['bait', SafariBattle.selectedBait().type]); enemy.eating = 2; enemy.eatingBait = SafariBattle.selectedBait().type; }, throwRock: () => { actions.push('rock'); enemy.angry = 2; }, throwBall: () => actions.push('ball'), run: () => actions.push('run') };
    const h = load('custom/autosafarizone.user.js', '<div id="safariModal"><div class="modal-header"></div><button onclick="Safari.closeModal()">Quit</button></div>', {
        Safari, SafariBattle, BaitList: baits, BaitType: { Bait: 0, Razz: 1, Pinap: 2, Nanab: 3 }, BerryType: { Nanab: 0, Razz: 1 },
        App: { isUsingClient: true, game: { farming: { berryInventory: [() => 50, () => 50] }, party: { alreadyCaughtPokemon: () => false, alreadyCaughtPokemonByName: () => false, getPokemon: () => ({ pokerus: 2 }), getPokemonByName: () => ({ pokerus: 2 }) }, statistics: { safariBaitThrown: () => 1000 } } },
        GameHelper: { enumNumbers: value => Object.values(value).filter(v => typeof v === 'number') },
        GameConstants: { Region: { kanto: 0, johto: 1, alola: 6, none: -1, final: 8 }, SafariTile: { grass: 1, waterUL: 2, waterDR: 2 }, SAFARI_WATER_BLOCKS: [2], SAFARI_LEGAL_WALK_BLOCKS: [0, 1, 2], Pokerus: { Contagious: 2 } },
        SafariEnvironments: { Grass: 0, Water: 1 }, SafariPokemonList: { list: [() => [{ name: 'Ditto (Magikarp)', environments: [0], weight: 1, isAvailable: () => true }], () => []] },
        PokemonHelper: { calcNativeRegion: () => 0 }, pokemonMap: {}, player: { region: 0, town: { name: 'Hoppy Town Fishing Pond' }, highestRegion: () => 0 },
        DisplayObservables: { modalState: { safariModal: 'show' } },
    }, storage);
    h.w.initAutoSafari();
    h.w.document.getElementById('auto-safari-toggle').click();
    if (battle) {
        Safari.inBattle = () => false;
        h.tick();
        actions.length = 0;
        Safari.inBattle = () => true;
    }
    return { ...h, actions, Safari, SafariBattle };
}
test('Safari uses the current berry inventory and progresses after bait', () => {
    const h = safari({ battle: true, storage: { autoSafariThrowBaitsState: true, autoSafariSeekContagious: true } });
    h.tick(); h.tick(); h.tick(); h.tick();
    assert.deepEqual(h.actions, [['bait', 3], 'rock', 'ball']);
});
test('Safari handles an existing Pinap effect without repeatedly throwing bait', () => {
    const h = safari({ battle: true, storage: { autoSafariThrowBaitsState: true, autoSafariSeekContagious: true } });
    h.SafariBattle.enemy.eatingBait = 2;
    h.tick(); h.tick(); h.tick();
    assert.deepEqual(h.actions, ['rock', 'ball']);
});
test('Safari can restart cleanly after no reachable encounters', () => {
    const h = safari({ grid: [[0]] });
    h.tick();
    assert.equal(h.timers.size, 0);
    h.w.document.getElementById('auto-safari-toggle').click();
    assert.equal(h.timers.size, 1);
    h.tick();
    assert.equal(h.timers.size, 0);
});
test('Safari reaches isolated grass for Ditto and can walk out and back', () => {
    const h = safari({ grid: [[0, 1]], storage: { autoSafariSeekContagious: true } });
    h.tick();
    assert.deepEqual(h.actions, ['right']);
    h.Safari.playerXY.x = 1;
    h.tick(); h.tick();
    assert.deepEqual(h.actions, ['right', 'left', 'right']);
});
for (const [amount, shiny, expected] of [[25, false, 'rock'], [26, false, ['bait', 3]], [5, true, ['bait', 0]], [6, true, ['bait', 3]]]) {
    test(`Safari preserves berry reserves at ${amount}, shiny=${shiny}`, () => {
        const h = safari({ battle: true, storage: { autoSafariThrowBaitsState: true, autoSafariSeekContagious: true } });
        h.w.App.game.farming.berryInventory = [() => amount, () => 0];
        h.SafariBattle.enemy.shiny = shiny;
        h.tick(); h.tick();
        assert.deepEqual(h.actions, [expected]);
    });
}
