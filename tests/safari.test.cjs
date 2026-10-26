const test = require('node:test');
const assert = require('node:assert/strict');
const { load, observable } = require('./helpers.cjs');
function safari({ grid = [[1, 1]], position = { x: 0, y: 0 }, battle = false, storage = {}, pokemon = [], items = [], caughtIds = [] } = {}) {
    const actions = [];
    const Safari = { grid, playerXY: position, pokemonGrid: () => pokemon, itemGrid: () => items, isMoving: false, moveSpeed: 250, inProgress: () => true, inBattle: () => battle, activeRegion: () => 0, balls: () => 10, step: dir => actions.push(dir) };
    const baits = { Bait: { type: 0 }, Razz: { type: 1 }, Pinap: { type: 2 }, Nanab: { type: 3 } };
    const enemy = { id: 1, name: 'Ditto (Magikarp)', shiny: false, angry: 0, eating: 0, eatingBait: 0, catchFactor: 5, levelModifier: 0 };
    const SafariBattle = { Speed: {}, busy: () => false, enemy, selectedBait: observable(baits.Bait), throwBait: () => { actions.push(['bait', SafariBattle.selectedBait().type]); enemy.eating = 2; enemy.eatingBait = SafariBattle.selectedBait().type; }, throwRock: () => { actions.push('rock'); enemy.angry = 2; }, throwBall: () => actions.push('ball'), run: () => actions.push('run') };
    const h = load('custom/autosafarizone.user.js', '<div id="safariModal"><div class="modal-header"></div><button onclick="Safari.closeModal()">Quit</button></div>', {
        Safari, SafariBattle, BaitList: baits, BaitType: { Bait: 0, Razz: 1, Pinap: 2, Nanab: 3 }, BerryType: { Nanab: 0, Razz: 1 },
        App: { isUsingClient: true, game: { farming: { berryInventory: [() => 50, () => 50] }, party: { alreadyCaughtPokemon: id => caughtIds.includes(id), alreadyCaughtPokemonByName: () => false, getPokemon: () => ({ pokerus: 2 }), getPokemonByName: () => ({ pokerus: 2 }) }, statistics: { safariBaitThrown: () => 1000 } } },
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

function visiblePokemon(id, x, y, shiny = false) {
    return { id, name: id === 129 ? 'Magikarp' : 'Psyduck', x, y, shiny, steps: 100 };
}

for (const tile of [0, 2]) {
    test(`Seek New pursues an uncaught visible Pokemon on tile ${tile} before random grass encounters`, () => {
        const h = safari({ grid: [[0, tile], [1, 1]], pokemon: [visiblePokemon(129, 1, 0)], storage: { autoSafariSeekUncaught: true } });
        h.tick();
        assert.deepEqual(h.actions, ['right']);
    });
}

test('Seek New ignores caught visible Pokemon and selects the nearest reachable uncaught one', () => {
    const h = safari({ grid: [[0, 0, 2], [0, 0, 2], [1, 0, 0]], pokemon: [visiblePokemon(129, 0, 1), visiblePokemon(54, 2, 1), visiblePokemon(60, 2, 0)], caughtIds: [129], storage: { autoSafariSeekUncaught: true } });
    h.tick();
    h.Safari.playerXY.x = 1;
    h.tick();
    assert.deepEqual(h.actions, ['right', 'right']);
});

test('Seek New routes around obstacles and ignores an unreachable visible target', () => {
    const h = safari({ grid: [[0, 1, 9, 2], [0, 9, 9, 9], [0, 0, 0, 2]], pokemon: [visiblePokemon(129, 3, 0), visiblePokemon(54, 3, 2)], storage: { autoSafariSeekUncaught: true } });
    h.tick();
    h.Safari.playerXY.y = 1;
    h.tick();
    h.Safari.playerXY.y = 2;
    h.tick();
    assert.deepEqual(h.actions, ['down', 'down', 'right']);
    assert.equal(h.timers.size, 1);
});

test('Seek New resumes random encounters when all visible targets are unreachable', () => {
    const h = safari({ grid: [[0, 9, 2], [1, 9, 9]], pokemon: [visiblePokemon(129, 2, 0)], storage: { autoSafariSeekUncaught: true } });
    h.tick(); h.tick();
    assert.deepEqual(h.actions, ['down', 'down']);
    assert.equal(h.timers.size, 1);
});

test('Seek New replans when a visible target moves, then resumes encounters when it disappears', () => {
    const target = visiblePokemon(129, 2, 0);
    const h = safari({ grid: [[0, 0, 2], [1, 0, 2]], pokemon: [target], storage: { autoSafariSeekUncaught: true } });
    h.tick();
    h.Safari.playerXY.x = 1;
    target.y = 1;
    h.tick();
    h.Safari.playerXY.y = 1;
    h.Safari.pokemonGrid = () => [];
    h.tick();
    assert.deepEqual(h.actions, ['right', 'down', 'left']);
});

for (const change of ['disable', 'caught']) {
    test(`Seek New drops a visible target after ${change}`, () => {
        const caughtIds = [];
        const h = safari({ grid: [[0, 0, 2], [1, 0, 2]], pokemon: [visiblePokemon(129, 2, 0)], caughtIds, storage: { autoSafariSeekUncaught: true } });
        h.tick();
        if (change === 'disable') h.w.document.getElementById('auto-seek-uncaught-toggle').click();
        else caughtIds.push(129);
        h.tick();
        assert.deepEqual(h.actions, ['right', 'down']);
    });
}

test('Seek New OFF leaves visible uncaught Pokemon to the existing encounter logic', () => {
    const h = safari({ grid: [[0, 2], [1, 1]], pokemon: [visiblePokemon(129, 1, 0)] });
    h.tick();
    assert.deepEqual(h.actions, ['down']);
});

test('A visible shiny still takes precedence over a closer uncaught Pokemon', () => {
    const h = safari({ grid: [[0, 2], [0, 0], [2, 0]], pokemon: [visiblePokemon(129, 1, 0), visiblePokemon(54, 0, 2, true)], caughtIds: [54], storage: { autoSafariSeekUncaught: true } });
    h.tick();
    assert.deepEqual(h.actions, ['down']);
});

test('The last ball is reserved for items even when an uncaught Pokemon is visible', () => {
    const h = safari({ grid: [[0, 2], [0, 0]], pokemon: [visiblePokemon(129, 1, 0)], items: [{ x: 0, y: 1 }], storage: { autoSafariSeekUncaught: true } });
    h.Safari.balls = () => 1;
    h.tick();
    h.Safari.inBattle = () => true;
    h.tick(); h.tick();
    assert.deepEqual(h.actions, ['down', 'run']);
});

for (const caught of [false, true]) {
    test(`A battle during visible pursuit ${caught ? 'flees a caught interruption' : 'tries to capture the uncaught Pokemon'}`, () => {
        const h = safari({ grid: [[0, 0, 2], [1, 0, 0]], pokemon: [visiblePokemon(129, 2, 0)], caughtIds: caught ? [1] : [], storage: { autoSafariSeekUncaught: true } });
        h.tick();
        h.SafariBattle.enemy.id = caught ? 1 : 129;
        h.Safari.inBattle = () => true;
        h.tick(); h.tick();
        if (!caught) h.tick();
        assert.deepEqual(h.actions, caught ? ['right', 'run'] : ['right', 'rock', 'ball']);
    });
}
test('Safari uses the current berry inventory and progresses after bait', () => {
    const h = safari({ battle: true, storage: { autoSafariThrowBaitsState: true, autoSafariSeekContagious: true } });
    h.tick(); h.tick(); h.tick(); h.tick();
    assert.deepEqual(h.actions, [['bait', 3], 'rock', 'ball']);
});
test('Visible pursuit preserves contagious capture priority when Seek PKRS is also ON', () => {
    const h = safari({ grid: [[0, 0, 2], [1, 0, 0]], pokemon: [visiblePokemon(129, 2, 0)], caughtIds: [1], storage: { autoSafariSeekUncaught: true, autoSafariSeekContagious: true } });
    h.tick();
    h.Safari.inBattle = () => true;
    h.tick(); h.tick(); h.tick();
    assert.deepEqual(h.actions, ['right', 'rock', 'ball']);
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
