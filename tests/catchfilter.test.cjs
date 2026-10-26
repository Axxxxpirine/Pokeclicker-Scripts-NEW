const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const species = [
    { id: 1, name: 'Bulbasaur', type1: 0, type2: 1 },
    { id: 2, name: 'Ivysaur', type1: 0, type2: 1 },
    { id: 25, name: 'Pikachu', type1: 2, type2: -1 },
];
const source = fs.readFileSync(require.resolve('../catchfilterfantasia.user.js'), 'utf8');
function fixture(storage = {}, list = species) {
    const dom = new JSDOM('<div id="pokeballSelector"></div><div id="profileModal"></div>', { url: 'https://www.pokeclicker.com/', runScripts: 'outside-only' });
    const w = dom.window;
    const fallback = [];
    Object.assign(w, {
        pokemonList: list, PokemonType: Array.from({ length: 18 }, (_, i) => `Type ${i}`),
        PokemonHelper: { getPokemonById: id => list.find(p => p.id === id) },
        GameConstants: { Pokeball: { None: -1 }, Pokerus: { 0: 'Uninfected', 1: 'Infected', 2: 'Contagious', 3: 'Resistant', Uninfected: 0 } },
        App: { isUsingClient: true, game: {
            party: { getPokemon: id => id === 1 ? { pokerus: 2 } : id === 2 ? { pokerus: 3 } : undefined },
            pokeballs: { pokeballs: Array.from({ length: 14 }, () => ({ quantity: () => 1 })), calculatePokeballToUse(...args) { fallback.push(args); return 2; } },
        } },
    });
    for (const [key, value] of Object.entries(storage)) w.localStorage.setItem(key, value);
    w.eval(source);
    w.initCatchFilter();
    const click = selector => w.document.querySelector(selector).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    const search = value => {
        const input = w.document.getElementById('filter-search');
        input.value = value;
        input.dispatchEvent(new w.Event('input', { bubbles: true }));
    };
    const saved = key => JSON.parse(w.localStorage.getItem(key));
    const snapshot = () => Object.fromEntries(Array.from({ length: w.localStorage.length }, (_, i) => { const k = w.localStorage.key(i); return [k, w.localStorage.getItem(k)]; }));
    return { w, dom, click, search, saved, snapshot, fallback };
}

test('Reset Balls isolates one species and normal/shiny choices across all 1636 entries', () => {
    const list = Array.from({ length: 1636 }, (_, i) => ({ id: i + 1, name: `Pokemon ${i + 1}`, type1: 0, type2: -1 }));
    const f = fixture({}, list);
    f.search('pokemon 1');
    f.click('#reset-ball-filter');
    f.click('[ball-pref="0"][pref-type="normal"]');
    const prefs = f.saved('filterBallPref');
    assert.deepEqual(prefs[0], { normal: 1, shiny: 0 });
    assert.ok(prefs.slice(1).every(p => p.normal === 0 && p.shiny === 0));
    f.click('[ball-pref="0"][pref-type="shiny"]');
    assert.deepEqual(f.saved('filterBallPref')[0], { normal: 1, shiny: 1 });
    assert.deepEqual(f.saved('filterBallPref')[1], { normal: 0, shiny: 0 });
    f.dom.window.close();
});

test('new and extended preferences are isolated and preserved after reload', () => {
    for (const storage of [{}, { filterBallPref: '[{"normal":3,"shiny":4}]' }]) {
        const f = fixture(storage);
        f.search('');
        f.click('[ball-pref="1"][pref-type="normal"]');
        f.click('[ball-pref="2"][pref-type="shiny"]');
        assert.deepEqual(f.saved('filterBallPref').slice(1), [{ normal: 1, shiny: 0 }, { normal: 0, shiny: 1 }]);
        const saved = f.snapshot();
        const reloaded = fixture(saved);
        assert.deepEqual(reloaded.saved('filterBallPref'), f.saved('filterBallPref'));
        if (storage.filterBallPref) assert.deepEqual(reloaded.saved('filterBallPref')[0], { normal: 3, shiny: 4 });
        f.dom.window.close();
        reloaded.dom.window.close();
    }
});

test('search only changes displayed rows, never selection or ball preferences', () => {
    const f = fixture({ catchFilter: '[1,25]', filterBallPref: '[{"normal":4,"shiny":3}]' });
    const before = f.snapshot();
    f.search('PIKA');
    assert.equal(f.w.document.querySelectorAll('#filter-results > div').length, 1);
    assert.equal(f.w.document.querySelector('#filter-results > div').getAttribute('data-src'), '25');
    assert.deepEqual(f.snapshot(), before);
    f.search('no match');
    assert.deepEqual(f.snapshot(), before);
    f.dom.window.close();
});

test('malformed settings recover valid preferences and leave game saves untouched', () => {
    const f = fixture({
        filterState: '{broken', filterTypes: 'null', catchFilter: '{}',
        filterBallPref: '[{"normal":2,"shiny":99},null,7]',
        player: '{original player save}', save: '{original game save}',
    });
    assert.deepEqual(f.saved('filterBallPref'), [{ normal: 2, shiny: 0 }, { normal: 0, shiny: 0 }, { normal: 0, shiny: 0 }]);
    assert.equal(f.saved('filterState'), false);
    assert.deepEqual(f.saved('catchFilter'), []);
    assert.equal(f.saved('filterTypes').length, 18);
    assert.equal(f.w.localStorage.getItem('player'), '{original player save}');
    assert.equal(f.w.localStorage.getItem('save'), '{original game save}');
    assert.ok(Object.values(f.snapshot()).includes('{broken'), 'original invalid JSON is backed up');
    assert.ok(Object.values(f.snapshot()).includes('[{"normal":2,"shiny":99},null,7]'), 'original damaged preferences are backed up');
    f.dom.window.close();
});

test('longer saved preference arrays survive loading an older species list', () => {
    const f = fixture({ filterBallPref: '[{"normal":1,"shiny":2},{"normal":3,"shiny":4},{"normal":5,"shiny":6},{"normal":7,"shiny":8}]' });
    assert.deepEqual(f.saved('filterBallPref')[3], { normal: 7, shiny: 8 });
    f.dom.window.close();
});

test('invalid JSON and wrong-shaped preference storage safely initialize defaults', () => {
    for (const value of ['{broken', 'null', '{}', '"bad"']) {
        const f = fixture({ filterBallPref: value });
        assert.deepEqual(f.saved('filterBallPref'), Array.from({ length: 3 }, () => ({ normal: 0, shiny: 0 })));
        assert.ok(Object.values(f.snapshot()).includes(value));
        f.dom.window.close();
    }
});

test('ball choices wrap within bounds, reset individually and use the original game fallback', () => {
    const f = fixture({ filterState: 'true', catchFilter: '[1]', filterBallPref: '[{"normal":14,"shiny":4}]' });
    assert.equal(f.w.App.game.pokeballs.calculatePokeballToUse(1, false, false, 7), 13);
    f.click('[ball-pref="0"][pref-type="normal"]');
    assert.deepEqual(f.saved('filterBallPref')[0], { normal: 0, shiny: 4 });
    assert.equal(f.w.App.game.pokeballs.calculatePokeballToUse(1, false, true, 7), 2);
    assert.deepEqual(f.fallback[0], [1, false, true, 7]);
    assert.equal(f.w.App.game.pokeballs.calculatePokeballToUse(2, false, false, 7), -1);
    f.w.document.querySelector('[ball-pref="0"][pref-type="shiny"]').dispatchEvent(new f.w.MouseEvent('contextmenu', { bubbles: true }));
    assert.deepEqual(f.saved('filterBallPref')[0], { normal: 0, shiny: 0 });
    f.dom.window.close();
});

test('filtered lists tolerate unknown saved species without deleting their preferences', () => {
    const f = fixture({ catchFilter: '[1,9999,null,"bad",1]' });
    assert.deepEqual(f.saved('catchFilter'), [1,9999]);
    assert.equal(f.w.document.querySelectorAll('#filter-results > div').length, 1);
    f.dom.window.close();
});

test('clicking the shiny decoration toggles its species instead of adding ID zero', () => {
    const f = fixture();
    f.search('pika');
    f.click('.filter-shiny');
    assert.deepEqual(f.saved('catchFilter'), [25]);
    f.dom.window.close();
});

test('reset preserves uppercase search results', () => {
    const f = fixture();
    f.search('PIKA');
    f.click('#reset-ball-filter');
    assert.equal(f.w.document.querySelectorAll('#filter-results > div').length, 1);
    f.dom.window.close();
});

test('optional Pokérus column uses party status without changing filters and survives reload', () => {
    const f = fixture();
    f.search('');
    assert.equal(f.w.document.querySelectorAll('.filter-pokerus').length, 0);
    const checkbox = f.w.document.getElementById('filter-show-pokerus');
    assert.ok(checkbox, 'Pokérus display toggle exists');
    checkbox.checked = true;
    checkbox.dispatchEvent(new f.w.Event('change', { bubbles: true }));
    assert.deepEqual(Array.from(f.w.document.querySelectorAll('.filter-pokerus'), el => el.textContent), ['Contagious', 'Resistant', 'Uninfected']);
    assert.deepEqual(f.saved('catchFilter'), []);
    f.click('[data-src="25"] .filter-pokerus');
    assert.deepEqual(f.saved('catchFilter'), [25]);
    const reloaded = fixture(f.snapshot());
    assert.equal(reloaded.w.document.getElementById('filter-show-pokerus').checked, true);
    assert.equal(reloaded.w.document.querySelector('.filter-pokerus').textContent, 'Uninfected');
    f.dom.window.close();
    reloaded.dom.window.close();
});

test('unavailable ball definitions and unknown encounters fall back safely', () => {
    const f = fixture({ filterState: 'true', catchFilter: '[1]', filterBallPref: '[{"normal":14,"shiny":4}]' });
    f.w.App.game.pokeballs.pokeballs.length = 4;
    assert.equal(f.w.App.game.pokeballs.calculatePokeballToUse(1, false, false, 7), 2);
    assert.equal(f.w.App.game.pokeballs.calculatePokeballToUse(9999, false, false, 7), 2);
    f.dom.window.close();
});

test('Pokérus display works on route and dungeon lists and toggles off without changing selection', () => {
    const f = fixture({ filterShowPokerus: 'true', catchFilter: '[1]' });
    f.w.player = { region: 0, route: 1 };
    f.w.Routes = { getRoute: () => ({ pokemon: { land: ['Bulbasaur', 'Ivysaur'], special: [{ pokemon: ['Bulbasaur', 'Pikachu'] }] } }) };
    f.click('#filter-route');
    assert.deepEqual(Array.from(f.w.document.querySelectorAll('.filter-pokerus'), el => el.textContent), ['Contagious', 'Resistant', 'Uninfected']);
    class DungeonBossPokemon { constructor() { this.name = 'Ivysaur'; } }
    f.w.DungeonRunner = { dungeon: { enemyList: ['Bulbasaur', { pokemon: 'Pikachu' }], bossList: [new DungeonBossPokemon()] } };
    f.click('#filter-dungeon');
    assert.deepEqual(Array.from(f.w.document.querySelectorAll('.filter-pokerus'), el => el.textContent), ['Contagious', 'Uninfected', 'Resistant']);
    const checkbox = f.w.document.getElementById('filter-show-pokerus');
    checkbox.checked = false;
    checkbox.dispatchEvent(new f.w.Event('change', { bubbles: true }));
    assert.equal(f.w.document.querySelectorAll('.filter-pokerus').length, 0);
    assert.equal(f.w.document.querySelectorAll('#filter-results > div').length, 3);
    assert.deepEqual(f.saved('catchFilter'), [1]);
    f.dom.window.close();
});
