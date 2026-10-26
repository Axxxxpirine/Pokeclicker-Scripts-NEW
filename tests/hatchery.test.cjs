const test = require('node:test');
const assert = require('node:assert/strict');
const { load, observable } = require('./helpers.cjs');
function hatchery() {
    let filled = 0;
    const breeding = { eggSlots: 4, hatchPokemonEgg() {}, hasFreeEggSlot: () => filled < 4, addPokemonToHatchery: () => { filled++; return true; }, canAccess: () => true };
    const h = load('enhancedautohatchery.user.js', '<div id="breedingDisplay"><div class="card-header"></div></div><div id="breedingModal"><div class="modal-header"><div class="d-none"><button>close</button><button data-bind="visible: false">warning</button></div></div></div>', {
        App: { isUsingClient: true, game: { breeding, party: { caughtPokemon: [{ isHatchable: () => true }] } } },
        BreedingController: { hatcherySortedFilteredList: () => [], hatcheryFilteredList: observable([]) },
        Settings: { getSetting: () => ({ observableValue: observable(false) }) },
        GameConstants: {}, UndergroundItems: { list: [{ valueType: 1, itemName: 'Helix_fossil', name: 'Helix Fossil' }] },
        UndergroundItemValueType: { Fossil: 1 }, player: { itemList: { Helix_fossil: () => 5 } },
        PartyController: { getCaughtStatusByName: () => 0 },
    }, { autoFossil: true, shinyFossil: true });
    return { ...h, breeding, filled: () => filled };
}
test('saved fossil settings cannot break ordinary hatching after fossil incubation removal', () => {
    const h = hatchery();
    h.run('autoHatcher()');
    assert.equal(h.filled(), 4);
});
test('hatchery controls stay outside hidden game warning containers', () => {
    const h = hatchery();
    h.w.initAutoHatch();
    const button = h.w.document.getElementById('auto-egg');
    assert.equal(button.closest('.d-none'), null);
    assert.equal(h.w.document.getElementById('auto-fossil').disabled, true);
});
test('hatcher yields even if an egg action reports success without occupying a slot', () => {
    const h = hatchery();
    h.w.fossilState = false;
    h.w.eggState = true;
    let uses = 0;
    h.w.autoHatchEgg = () => { uses++; return true; };
    h.run('autoHatcher()');
    assert.ok(uses <= 4);
});
test('stopped hatchery does not run from progress callback and can resume', () => {
    const h = hatchery();
    let progress = 0;
    h.w.Breeding = function() {};
    h.w.Breeding.prototype.progressEggs = () => ++progress;
    h.w.bindAutoHatcher();
    const b = new h.w.Breeding();
    h.w.hatchState = false;
    b.progressEggs();
    assert.equal(h.filled(), 0);
    h.w.hatchState = true;
    b.progressEggs();
    assert.equal(progress, 2);
    assert.equal(h.filled(), 4);
});
