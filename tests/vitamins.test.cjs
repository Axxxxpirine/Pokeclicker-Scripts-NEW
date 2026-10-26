const test = require('node:test');
const assert = require('node:assert/strict');
const { load, observable } = require('./helpers.cjs');
function vitamins(storage = {}) {
    const inventory = { Protein: observable(5000), Calcium: observable(5000), Carbos: observable(5000) };
    const actions = [];
    class PartyPokemon {
        constructor() { this.vitaminsUsed = [observable(0), observable(0), observable(0)]; this.breeding = false; }
        useVitamin() { return 'native'; }
    }
    const original = PartyPokemon.prototype.useVitamin;
    const challenge = observable(false);
    const h = load('custom/omegaproteingains.user.js', '<div id="settingsModal"><div></div><ul class="nav-tabs"></ul><div class="tab-content"></div></div>', {
        PartyPokemon,
        App: { isUsingClient: true, game: { challenges: { list: { disableVitamins: { active: challenge } } } } },
        GameConstants: { VitaminType: { Protein: 0, Calcium: 1, Carbos: 2, 0: 'Protein', 1: 'Calcium', 2: 'Carbos' } },
        player: { itemList: inventory },
        ItemHandler: { useItem(name, amount) { actions.push([name, amount]); inventory[name](inventory[name]() - amount); return true; } },
        GameHelper: { incrementObservable(obs, amount) { obs(obs() + amount); } },
        Notifier: { notify() {} }, NotificationConstants: { NotificationOption: { warning: 'warning', danger: 'danger' } },
    }, storage);
    h.w.initOmegaProtein();
    return { ...h, original, PartyPokemon, pokemon: new PartyPokemon(), inventory, actions, challenge,
        settings: h.w.omegaProteinSettings, el: id => h.w.document.getElementById(id) };
}
test('vitamins leave the native method intact by default and ignore saved activation flags', () => {
    const h = vitamins({ omegaProteinEnabled: true, omegaProteinUnlimited: true, omegaProteinCap: 250 });
    assert.equal(h.PartyPokemon.prototype.useVitamin, h.original);
    assert.equal(h.el('omega-protein-enabled')?.checked, false);
    assert.equal(h.el('omega-protein-unlimited')?.checked, false);
    assert.equal(h.el('omega-protein-cap')?.value, '250');
});
test('finite override caps each vitamin independently and consumes the actual inventory amount', () => {
    const h = vitamins(); h.settings.setEnabled(true); h.settings.setCap(120);
    h.pokemon.vitaminsUsed[0](110); h.pokemon.useVitamin(0, 25);
    h.inventory.Calcium(12); h.pokemon.useVitamin(1, 50);
    assert.equal(h.pokemon.vitaminsUsed[0](), 120); assert.equal(h.inventory.Protein(), 4990);
    assert.equal(h.pokemon.vitaminsUsed[1](), 12); assert.equal(h.inventory.Calcium(), 0);
    assert.deepEqual(h.actions, [['Protein', 10], ['Calcium', 12]]);
});
test('lowering the personal ceiling preserves existing vitamins and prevents additional spending', () => {
    const h = vitamins(); h.settings.setEnabled(true); h.pokemon.vitaminsUsed[0](500);
    h.settings.setCap(100); h.pokemon.useVitamin(0, 10);
    assert.equal(h.pokemon.vitaminsUsed[0](), 500); assert.equal(h.inventory.Protein(), 5000);
    assert.deepEqual(h.actions, []);
});
test('unlimited Protein and Calcium require explicit opt-in and Carbos still stops at 70', () => {
    const h = vitamins(); h.settings.setEnabled(true);
    h.pokemon.useVitamin(0, 1500); assert.equal(h.pokemon.vitaminsUsed[0](), 1000);
    h.settings.setUnlimited(true); h.pokemon.useVitamin(0, 1500); h.pokemon.useVitamin(1, 2500);
    h.pokemon.vitaminsUsed[2](65); h.pokemon.useVitamin(2, 100); h.pokemon.useVitamin(2, 1);
    assert.equal(h.pokemon.vitaminsUsed[0](), 2500); assert.equal(h.pokemon.vitaminsUsed[1](), 2500);
    assert.equal(h.pokemon.vitaminsUsed[2](), 70); assert.equal(h.inventory.Carbos(), 4995);
    h.settings.setUnlimited(false); h.pokemon.useVitamin(0, 1); assert.equal(h.pokemon.vitaminsUsed[0](), 2500);
});
test('invalid quantities and vitamin types cannot mutate vitamins or inventory', () => {
    const h = vitamins(); h.settings.setEnabled(true);
    for (const amount of [NaN, -Infinity, -1, 0, 0.5, '1', null, undefined, Number.MAX_SAFE_INTEGER + 1]) h.pokemon.useVitamin(0, amount);
    for (const vitamin of [-1, 3, NaN, 'Protein', '0', '__proto__', null]) h.pokemon.useVitamin(vitamin, 1);
    assert.deepEqual(h.actions, []); assert.equal(h.pokemon.vitaminsUsed[0](), 0); assert.equal(h.inventory.Protein(), 5000);
});
test('challenge and hatchery restrictions remain enforced', () => {
    const h = vitamins(); h.settings.setEnabled(true); h.settings.setUnlimited(true);
    h.challenge(true); h.pokemon.useVitamin(0, 20);
    h.challenge(false); h.pokemon.breeding = true; h.pokemon.useVitamin(1, 20);
    assert.deepEqual(h.actions, []); assert.equal(h.pokemon.vitaminsUsed[0](), 0);
});
test('disabling restores original method and initialization cannot stack or re-enable overrides', () => {
    const h = vitamins(); h.settings.setEnabled(true); const override = h.PartyPokemon.prototype.useVitamin;
    h.settings.setEnabled(true); assert.equal(h.PartyPokemon.prototype.useVitamin, override);
    h.settings.setEnabled(false); assert.equal(h.PartyPokemon.prototype.useVitamin, h.original);
    h.settings.setEnabled(true); h.settings.setUnlimited(true); h.w.initOmegaProtein();
    assert.equal(h.PartyPokemon.prototype.useVitamin, h.original);
    assert.equal(h.el('omega-protein-enabled').checked, false); assert.equal(h.el('omega-protein-unlimited').checked, false);
    assert.equal(h.w.document.querySelectorAll('#omega-protein-enabled').length, 1);
});
test('settings controls have labels, save valid cap while OFF, and enable only on explicit click', () => {
    const h = vitamins();
    for (const id of ['omega-protein-enabled', 'omega-protein-unlimited', 'omega-protein-cap']) assert.ok(h.w.document.querySelector(`label[for="${id}"]`));
    h.el('omega-protein-cap').value = '42'; h.el('omega-protein-cap').dispatchEvent(new h.w.Event('change'));
    assert.equal(h.w.localStorage.getItem('omegaProteinCap'), '42'); assert.equal(h.PartyPokemon.prototype.useVitamin, h.original);
    h.el('omega-protein-enabled').click(); h.pokemon.useVitamin(0, 100); assert.equal(h.pokemon.vitaminsUsed[0](), 42);
    h.el('omega-protein-enabled').click(); assert.equal(h.PartyPokemon.prototype.useVitamin, h.original);
});
test('invalid saved and edited ceilings fall back safely without erasing a valid setting', () => {
    for (const cap of [-1, 0.5, null, '99', 1e100]) {
        const h = vitamins({ omegaProteinCap: cap }); assert.equal(h.el('omega-protein-cap')?.value, '1000');
    }
    const h = vitamins({ omegaProteinCap: 55 });
    for (const cap of [NaN, Infinity, -1, 0.5, '', '5', null]) assert.equal(h.settings.setCap(cap), false);
    assert.equal(h.el('omega-protein-cap').value, '55');
    assert.equal(h.w.localStorage.getItem('omegaProteinCap'), '55');
});
test('zero ceiling, empty stock and malformed game values never spend inventory', () => {
    const h = vitamins(); h.settings.setEnabled(true); h.settings.setCap(0); h.pokemon.useVitamin(0, 20);
    h.settings.setCap(100); h.inventory.Calcium(0); h.pokemon.useVitamin(1, 20);
    for (const invalid of [NaN, Infinity, -1, 1.5]) {
        h.inventory.Protein(invalid); h.pokemon.useVitamin(0, 20);
        h.inventory.Protein(20); h.pokemon.vitaminsUsed[0](invalid); h.pokemon.useVitamin(0, 20); h.pokemon.vitaminsUsed[0](0);
    }
    assert.deepEqual(h.actions, []);
});
test('refused inventory use cannot increase the vitamin count', () => {
    const h = vitamins(); h.settings.setEnabled(true); h.w.ItemHandler.useItem = () => false;
    h.pokemon.useVitamin(0, 30); assert.equal(h.pokemon.vitaminsUsed[0](), 0); assert.equal(h.inventory.Protein(), 5000);
});
test('OFF deactivates a retained wrapper without replacing a later script method', () => {
    const h = vitamins(); h.settings.setEnabled(true);
    const omega = h.PartyPokemon.prototype.useVitamin;
    function later(...args) { return omega.apply(this, args); }
    h.PartyPokemon.prototype.useVitamin = later;
    h.settings.setEnabled(false);
    assert.equal(h.PartyPokemon.prototype.useVitamin, later);
    assert.equal(h.pokemon.useVitamin(0, 10), 'native');
    assert.equal(h.pokemon.vitaminsUsed[0](), 0); assert.deepEqual(h.actions, []);
    h.settings.setEnabled(true);
    assert.equal(h.PartyPokemon.prototype.useVitamin, later);
    assert.equal(h.el('omega-protein-enabled').checked, false);
    assert.equal(h.pokemon.useVitamin(0, 10), 'native');
});
test('activation refuses to overwrite another script installed after initialization', () => {
    const h = vitamins();
    function later() { return 'later'; }
    h.PartyPokemon.prototype.useVitamin = later;
    h.settings.setEnabled(true);
    assert.equal(h.PartyPokemon.prototype.useVitamin, later);
    assert.equal(h.el('omega-protein-enabled').checked, false);
    assert.equal(h.pokemon.useVitamin(0, 10), 'later');
    assert.deepEqual(h.actions, []);
});

test('native Max sentinel is clamped to finite stock and personal ceiling', () => {
    const h = vitamins(); h.settings.setEnabled(true); h.settings.setCap(120);
    h.pokemon.vitaminsUsed[0](110); h.pokemon.useVitamin(0, Infinity);
    assert.equal(h.pokemon.vitaminsUsed[0](),120); assert.equal(h.inventory.Protein(),4990);
    h.settings.setUnlimited(true); h.inventory.Calcium(12); h.pokemon.useVitamin(1, Infinity);
    assert.equal(h.pokemon.vitaminsUsed[1](),12); assert.equal(h.inventory.Calcium(),0);
    h.pokemon.vitaminsUsed[2](65); h.pokemon.useVitamin(2, Infinity);
    assert.equal(h.pokemon.vitaminsUsed[2](),70); assert.equal(h.inventory.Carbos(),4995);
    assert.equal(h.settings.setCap(Infinity),false);
});
