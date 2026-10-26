const test = require('node:test');
const assert = require('node:assert/strict');
const { load, observable } = require('./helpers.cjs');
function mon(id, props = {}) { return { id, name: `Pokemon${id}`, breeding: false, level: 100, pokerus: 0, isHatchable() { return !this.breeding && this.level >= 100; }, matchesHatcheryFilters() { return !this.excluded; }, ...props }; }
function hatchery(party, filtered = party, storage = {}) {
    const added = [];
    const breeding = { eggList: Array.from({ length: 4 }, (_, i) => () => ({ isNone: () => i >= added.length })), hatcheryHelpers: { hired: () => [] }, eggSlots: 4, hatchPokemonEgg() {}, hasFreeEggSlot: () => added.length < 4, canAccess: () => true,
        addPokemonToHatchery(p) { if (!this.hasFreeEggSlot() || !p.isHatchable()) return false; added.push(p.id); p.breeding = true; return true; } };
    const h = load('enhancedautohatchery.user.js', '<div id="breedingDisplay"><div class="card-header"></div></div><div id="breedingModal"><div class="modal-header"></div></div>', {
        App: { isUsingClient: true, game: { breeding, party: { caughtPokemon: party }, keyItems: { hasKeyItem: () => true } } },
        BreedingController: { hatcherySortedFilteredList: () => filtered, hatcheryFilteredList: observable(filtered) },
        Settings: { getSetting: () => ({ observableValue: observable(false) }) },
        pokemonList: party.map(p => ({ id: p.id, name: p.name })),
        pokemonMap: Object.fromEntries(party.map(p => [p.name, { id: p.id, type: [0] }])),
        GameConstants: { SECOND: 1000, Pokerus: { Uninfected: 0, Contagious: 2 } },
        KeyItemType: { Pokerus_virus: 0 }, PokemonType: { Normal: 0 }, GameHelper: { enumNumbers: () => [0] },
    }, storage);
    h.w.initAutoHatch();
    return { ...h, added, party, breeding, button: id => h.w.document.getElementById(id) };
}
function save(h, value) { h.button('priority-ids').value = value; h.button('priority-save').click(); }
test('Filter Only waits on an empty filter, OFF preserves fallback', () => {
    const h = hatchery([mon(1)], [], { filterOnly: true });
    h.w.autoHatcher(); assert.deepEqual(h.added, []);
    h.button('filter-only').click(); h.w.autoHatcher(); assert.deepEqual(h.added, [1]);
    assert.equal(h.w.localStorage.getItem('filterOnly'), 'false');
});
test('strict filtering excludes priority and Pokérus bypasses and suspends random eggs', () => {
    const excluded = mon(2, { pokerus: 2, excluded: true }); const allowed = mon(1);
    const h = hatchery([excluded, allowed], [allowed], { filterOnly: true, pokerusModeState: true, priorityMonIds: [2], autoEgg: true });
    let eggCalls = 0; h.w.autoHatchEgg = () => { eggCalls++; return true; };
    h.w.autoHatcher(); assert.deepEqual(h.added, [1]); assert.equal(eggCalls, 0);
});
test('strict filtering checks current matches even if the game filtered list is rate limited', () => {
    const p = mon(1, { excluded: true }); const h = hatchery([p], [p], { filterOnly: true });
    h.w.autoHatcher(); assert.deepEqual(h.added, []);
});
test('priority parsing rejects malformed and unknown IDs atomically and supports forms', () => {
    const h = hatchery([mon(1), mon(479.01), mon(479.02)]);
    save(h, '479.01, 1, 479.01'); assert.equal(h.w.localStorage.getItem('priorityMonIds'), '[479.01,1]');
    for (const s of ['-1', '1e3', '1abc', '479..01', '999999', 'Infinity', '0']) {
        save(h, s); assert.equal(h.w.localStorage.getItem('priorityMonIds'), '[479.01,1]', s);
        assert.match(h.button('priority-status').textContent, /invalid/i);
    }
    save(h, '479 1'); assert.equal(h.w.localStorage.getItem('priorityMonIds'), '[479,1]');
    save(h, ''); assert.equal(h.w.localStorage.getItem('priorityMonIds'), '[]');
});
test('decimal priority selects exactly that form and integers include alternate forms', () => {
    const h = hatchery([mon(479.02), mon(479.01), mon(1)], undefined, { priorityMonIds: [479.01] });
    h.w.autoHatcher(); assert.equal(h.added[0], 479.01);
    const h2 = hatchery([mon(1), mon(479.02)], undefined, { priorityMonIds: [479] });
    h2.w.autoHatcher(); assert.equal(h2.added[0], 479.02);
});
test('priority ordering rotates and normal candidates are not starved across calls', () => {
    const party = [mon(1), mon(2), mon(3)];
    const h = hatchery(party, undefined, { priorityMonIds: [3, 2] });
    h.breeding.eggSlots = 1; h.breeding.hasFreeEggSlot = () => true;
    const sequence = [];
    for (let i = 0; i < 6; i++) { h.w.autoHatcher(); sequence.push(h.added.at(-1)); party.forEach(p => p.breeding = false); }
    assert.deepEqual(sequence, [3, 1, 2, 1, 3, 1]);
});
test('unavailable priority never blocks eligible normal candidates', () => {
    const h = hatchery([mon(1), mon(2, { level: 99 })], undefined, { priorityMonIds: [2] });
    h.w.autoHatcher(); assert.deepEqual(h.added, [1]);
});
test('strict Pokérus requires both eligible partners and two actual free slots', () => {
    const h = hatchery([mon(1), mon(2, { pokerus: 2 })], undefined, { filterOnly: true, pokerusModeState: true });
    h.breeding.eggSlots = 1; h.breeding.hasFreeEggSlot = () => true;
    assert.equal(h.w.autoHatchPkrs(), false); assert.deepEqual(h.added, []);
});
test('corrupt priority storage is safe and options restore in the visible controls', () => {
    const h = hatchery([mon(1)], undefined, { filterOnly: true, priorityMonIds: { bad: 1 } });
    assert.equal(h.button('priority-ids').value, '');
    assert.match(h.button('filter-only').textContent, /ON/);
    assert.equal(h.button('priority-ids').closest('.modal-header'), null);
    const h2 = hatchery([mon(1)], undefined, { priorityMonIds: [1], filterOnly: true });
    assert.equal(h2.button('priority-ids').value, '1');
});
test('whole-ID priorities rotate forms instead of starving later family members', () => {
    const party = [mon(479), mon(479.01), mon(1)];
    const h = hatchery(party, undefined, { priorityMonIds: [479] });
    h.breeding.eggSlots = 1; h.breeding.hasFreeEggSlot = () => true;
    const sequence = [];
    for (let i = 0; i < 6; i++) { h.w.autoHatcher(); sequence.push(h.added.at(-1)); party.forEach(p => p.breeding = false); }
    assert.deepEqual(sequence, [479, 1, 479.01, 1, 479, 1]);
});
test('ID validation uses the complete species list, not enumerable proxy lookup entries', () => {
    const h = hatchery([mon(1)]);
    h.w.pokemonList = [{id:1}, {id:479.01}];
    h.w.pokemonMap = { 0: { id:1 } };
    save(h,'479.01'); assert.equal(h.w.localStorage.getItem('priorityMonIds'),'[479.01]');
});
test('strict Pokérus fills an eligible pair while respecting helper reservations', () => {
    const h = hatchery([mon(1), mon(2, { pokerus: 2 })], undefined, { filterOnly: true, pokerusModeState: true });
    assert.equal(h.w.autoHatchPkrs(), true); assert.deepEqual(h.added, [1, 2]);
    const h2 = hatchery([mon(1), mon(2, { pokerus: 2 })], undefined, { filterOnly: true, pokerusModeState: true });
    h2.breeding.hatcheryHelpers.hired = () => [{}, {}, {}];
    assert.equal(h2.w.autoHatchPkrs(), false); assert.deepEqual(h2.added, []);
});
