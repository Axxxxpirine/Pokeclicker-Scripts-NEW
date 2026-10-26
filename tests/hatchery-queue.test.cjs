const test = require('node:test');
const assert = require('node:assert/strict');
const {load, observable: o} = require('./helpers.cjs');
function mon(id, efficiency = 1, type = 0) { return {id, name: `Mon${id}`, breeding: false, level: 100, pokerus: 0, efficiency, type, breedingEfficiency() { return this.efficiency; }, isHatchable() { return !this.breeding && this.level >= 100; }, matchesHatcheryFilters() { return !this.excluded; }}; }
function setup(party, storage = {}, manual = [], capacity = 10, incubating = []) {
    const queue = manual.map(entry => [...entry]), added = [];
    const breeding = {
        eggSlots: 4, eggList: incubating.map(id => () => ({pokemon: id, isNone: () => false})), hatcheryHelpers: {hired: () => []},
        canAccess: () => true, hasFreeEggSlot: () => false, hatchPokemonEgg() {},
        queueList: () => queue, usableQueueSlots: () => capacity, hasFreeQueueSlot: () => queue.length < capacity,
        addPokemonToQueue(p) { if (queue.length >= capacity) return false; queue.push([0, p.id]); p.breeding = true; return true; },
        addPokemonToHatchery(p) {if (p.breeding) return false; added.push(p.id); p.breeding = true; return true;},
    };
    const h = load('enhancedautohatchery.user.js', '<div id="breedingDisplay"><div class="card-header"></div></div><div id="breedingModal"><div class="modal-header"></div></div>', {
        App: {isUsingClient: true, game: {breeding, party: {caughtPokemon: party}}},
        BreedingController: {hatcherySortedFilteredList: () => party, hatcheryFilteredList: o(party), calculateRegionalMultiplier: p => p.regionMultiplier ?? 1},
        Settings: {getSetting: () => ({observableValue: o(false)})},
        pokemonList: party.map(p => ({id: p.id, name: p.name})), pokemonMap: Object.fromEntries(party.map(p => [p.name, {id: p.id, type: [p.type]}])),
        PokemonHelper: {getPokemonById: id => {const p = party.find(p => p.id === id); return p ? {id, type1: p.type, type2: -1} : undefined;}},
        PokemonType: {None: -1, '-1': 'None', Normal: 0, 0: 'Normal', Fire: 1, 1: 'Fire', Water: 2, 2: 'Water'}, EggType: {Pokemon: 0, EggItem: 1},
        TypeHelper: {getAttackModifier(a1, a2, d1, d2) { assert.equal(a2, -1); return a1 === 1 && d1 === 2 ? (d2 === 0 ? 2 : 4) : 1;}}, GameConstants: {},
    }, storage);
    h.w.initAutoHatch();
    return {...h, party, queue, breeding, added, button: id => h.w.document.getElementById(id)};
}
test('queue and type options default OFF, persist explicit choices and do not run with Auto Hatch OFF', () => {
    const h = setup([mon(1)]);
    assert.match(h.button('auto-queue').textContent, /OFF/);
    assert.match(h.button('hatchery-type-sort').textContent, /OFF/);
    h.button('auto-queue').click(); h.w.autoHatcher(); assert.deepEqual(h.queue, []);
    assert.equal(h.w.localStorage.getItem('autoHatchQueue'), 'true');
    h.w.hatchState = true; h.w.autoHatcher(); assert.deepEqual(h.queue, [[0, 1]]);
    h.button('auto-queue').click(); h.party.push(mon(2)); h.w.autoHatcher(); assert.deepEqual(h.queue, [[0, 1]]);
});
test('native queue appends up to target, preserves manual entries, and skips incubating or queued species', () => {
    const h = setup([mon(1), mon(2), mon(3), mon(4), mon(5)], {autoHatchQueue: true, autoHatchQueueLimit: 4}, [[1, 7], [0, 1]], 8, [2]);
    h.w.hatchState = true; h.w.autoHatcher();
    assert.deepEqual(h.queue, [[1, 7], [0, 1], [0, 3], [0, 4]]);
    h.w.autoHatcher(); assert.equal(h.queue.length, 4);
});
test('queue respects native capacity, strict live filters and priority alternation', () => {
    const party = [mon(1), mon(2), mon(3), mon(4), mon(5)]; party[4].excluded = true;
    const h = setup(party, {autoHatchQueue: true, autoHatchQueueLimit: 10, filterOnly: true, priorityMonIds: [5, 3, 2]}, [], 4);
    h.w.hatchState = true; h.w.autoHatcher(); assert.deepEqual(h.queue, [[0, 3], [0, 1], [0, 2], [0, 4]]);
});
test('queue cannot bypass PKRS or random egg precedence and incompatible native APIs remain inert', () => {
    for (const setting of ['pokerusModeState', 'autoEgg']) {
        const h = setup([mon(1)], {autoHatchQueue: true, [setting]: true}); h.w.hatchState = true; h.w.autoHatcher(); assert.deepEqual(h.queue, []);
    }
    const h = setup([mon(1)], {autoHatchQueue: true}); delete h.breeding.addPokemonToQueue;
    h.w.hatchState = true; assert.doesNotThrow(() => h.w.autoHatcher()); assert.deepEqual(h.queue, []);
});
test('queue target validates input, honors smaller limits without truncation and yields on non-progress', () => {
    const h = setup([mon(1), mon(2)], {autoHatchQueue: true});
    const input = h.button('auto-queue-limit'); input.value = '1'; input.dispatchEvent(new h.w.Event('change'));
    assert.equal(h.w.localStorage.getItem('autoHatchQueueLimit'), '1');
    for (const value of ['', '0', '-1', '1.5', '101', '1e309']) {input.value = value; input.dispatchEvent(new h.w.Event('change')); assert.equal(h.w.localStorage.getItem('autoHatchQueueLimit'), '1');}
    h.w.hatchState = true; h.w.autoHatcher(); assert.deepEqual(h.queue, [[0, 1]]);
    h.queue.push([0, 99]); h.w.autoHatcher(); assert.deepEqual(h.queue, [[0, 1], [0, 99]]);
    const broken = setup([mon(1)], {autoHatchQueue: true}); let calls = 0; broken.breeding.addPokemonToQueue = () => {calls++; return true;};
    broken.w.hatchState = true; broken.w.autoHatcher(); assert.equal(calls, 1);
});
test('type efficiency applies native efficiency, region and dual target modifiers without replacing priorities', () => {
    const party = [mon(1, 10), mon(2, 4, 1), mon(3, 100)]; party[2].regionMultiplier = 0.01;
    const h = setup(party, {autoHatchTypeSort: true, autoHatchTargetType1: 2, autoHatchTargetType2: -1});
    h.w.autoHatchMon(); assert.deepEqual(h.added, [2]);
    party.forEach(p => p.breeding = false); h.added.length = 0;
    h.button('hatchery-target-type2').value = '0'; h.button('hatchery-target-type2').dispatchEvent(new h.w.Event('change'));
    h.w.autoHatchMon(); assert.deepEqual(h.added, [1]);
    assert.equal(h.w.localStorage.getItem('autoHatchTargetType2'), '0');
    const p = setup([mon(1, 10), mon(2, 4, 1)], {autoHatchTypeSort: true, autoHatchTargetType1: 2, priorityMonIds: [1]}); p.w.autoHatchMon(); assert.deepEqual(p.added, [1]);
});
test('disabled or unavailable type efficiency retains native order, invalid storage is safe', () => {
    const h = setup([mon(1, 1), mon(2, 100)], {autoHatchQueueLimit: Infinity, autoHatchTargetType1: 999});
    h.w.autoHatchMon(); assert.deepEqual(h.added, [1]);
    assert.equal(h.button('auto-queue-limit').value, '10');
    h.party.forEach(p => p.breeding = false); h.added.length = 0; h.button('hatchery-type-sort').click();
    delete h.w.TypeHelper; h.w.autoHatchMon(); assert.deepEqual(h.added, [1]);
});
