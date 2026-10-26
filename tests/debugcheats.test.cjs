const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { observable: o } = require('./helpers.cjs');

function setup(client = true, customize = () => {}) {
    const dom = new JSDOM('<div id="startMenu"><ul><li></li></ul></div><div id="profileModal"></div>', {url: 'https://www.pokeclicker.com/', runScripts: 'dangerously'});
    const w = dom.window;
    const money = o(10), item = o(2), berry = o(3), ball = o(4), gem = o(5), unlocked = o(false);
    const calls = [];
    class HeldItem { constructor() { this.name = 'Lucky_egg'; this.image = 'egg.png'; } gain(n) { item(item() + n); calls.push(['item', n]); } }
    const itemList = {Lucky_egg: new HeldItem(), Red_shard: {name: 'Red_shard', image: 'shard.png', gain(n) {item(item() + n); calls.push(['shard', n]);}}, Key_stone: {name: 'Key_stone', gain() {item(Math.max(item(), 1));}}};
    const party = new Map();
    const game = {
        wallet: {currencies: [money], addAmount(a, ignore) {assert.equal(ignore, true); money(money() + a.amount); calls.push(['money', a.amount]);}, loseAmount(a) {money(money() - a.amount); calls.push(['subtract', a.amount]);}},
        gems: {gemWallet: [gem], gainGems(n, i) {assert.equal(i, 0); gem(gem() + n);}},
        pokeballs: {pokeballs: [{quantity: ball}], gainPokeballs(i, n, purchase) {assert.equal(purchase, false); ball(ball() + n);}},
        farming: {berryInventory: [berry], gainBerry(i, n, farming) {assert.equal(farming, false); berry(berry() + n);}},
        keyItems: {itemList: [{id: 3, name: 'Explorer kit', isUnlocked: unlocked}], gainKeyItem(id) {assert.equal(id, 3); unlocked(true); calls.push(['key', id]);}},
        party: {getPokemon: id => party.get(id), gainPokemonById(id, shiny = false) {party.set(id, {shiny, pokerus: 0});}},
        quests: {questLines: () => []},
    };
    Object.assign(w, {App: {isUsingClient: client, game}, unsafeWindow: {}, Preload: {hideSplashScreen() {}},
        player: {highestRegion: () => 1, itemList: {Lucky_egg: item, Red_shard: item, Key_stone: item}},
        ItemList: itemList, HeldItem, Amount: class {constructor(amount, currency) {Object.assign(this, {amount, currency});}},
        GameConstants: {Currency: {0: 'money', money: 0}, Pokeball: {0: 'Pokeball', Pokeball: 0, None: -1, '-1': 'None'}, Region: {'-1': 'none', 0: 'kanto', 1: 'johto', none: -1, kanto: 0, johto: 1}, StoneType: {None: -1, '-1': 'None'}, VitaminType: {}, Pokerus: {Uninfected: 0, Contagious: 2, Resistant: 3}},
        Gems: {nTypes: 1}, PokemonType: {0: 'Normal'}, BerryType: {0: 'Cheri', Cheri: 0, None: -1, '-1': 'None'}, KeyItemType: {3: 'Explorer_kit'},
        UndergroundItems: {list: [{id: 7, itemName: 'Red_shard', displayName: 'Red shard', image: 'shard.png'}]},
        UndergroundController: {gainMineItem(id, n) {assert.equal(id, 7); itemList.Red_shard.gain(n);}},
        PokemonHelper: {calcNativeRegion: name => name === 'Johto Form' ? 1 : 0},
        PokemonLocations: {getPokemonLocations: () => ({0: {1: [{route: 2}]}})},
        pokemonList: [{id: 1, name: 'Bulbasaur'}, {id: 1.01, name: 'Johto Form'}],
        QuestLineState: {}, Notifier: {notify() {}}, NotificationConstants: {NotificationOption: {warning: 1}}});
    customize(w);
    w.localStorage.setItem('debugcheatstools', 'true');
    // Match the desktop loader's function scope and a distinct Tampermonkey unsafeWindow.
    vm.runInContext(`(function () {${fs.readFileSync('custom/debugcheatstools.user.js', 'utf8')}\n})();`, dom.getInternalVMContext());
    w.Preload.hideSplashScreen();
    return {w, game, money, item, berry, ball, gem, unlocked, calls, party, d: w.document};
}
function click(c, kind, key, value = '1', operation = 'add') {
    const button = c.d.querySelector(`[data-debug-kind="${kind}"][data-debug-key="${key}"]`);
    assert.ok(button, `Missing ${kind} ${key} control`);
    const pane = button.closest('.tab-pane');
    const input = pane.querySelector('input[type="number"]');
    if (input) input.value = value;
    const select = pane.querySelector('[data-debug-operation]');
    if (select) select.value = operation;
    button.click();
}
for (const client of [true, false]) test(`current catalogs and buttons work in ${client ? 'desktop' : 'userscript'} scope`, () => {
    const c = setup(client);
    assert.ok(c.d.querySelector('[data-debug-kind="heldItems"]'));
    assert.ok(c.d.querySelector('[data-debug-kind="underground"]'));
    assert.ok(c.d.querySelector('[data-debug-kind="keyItems"]'));
    assert.ok(c.d.querySelector('[data-debug-kind="items"][data-debug-key="Key_stone"]'));
    assert.equal(c.d.querySelectorAll('#saveEditorModal [onclick], #saveEditorModal [oninput], #saveEditorModal [onchange]').length, 0);
    assert.deepEqual(c.calls, []);
    click(c, 'heldItems', 'Lucky_egg', '2'); assert.equal(c.item(), 4);
    click(c, 'underground', '7', '3'); assert.equal(c.item(), 7);
    click(c, 'keyItems', '3'); assert.equal(c.unlocked(), true);
});
test('numeric grants parse scientific notation, reject invalid input and unsafe totals', () => {
    const c = setup();
    click(c, 'currency', '0', '1e3'); assert.equal(c.money(), 1010);
    for (const value of ['', '-1', '0', '1.5', 'Infinity', 'NaN', '1e309', '9007199254740992']) click(c, 'currency', '0', value);
    assert.equal(c.money(), 1010);
    c.money(Number.MAX_SAFE_INTEGER); click(c, 'currency', '0', '1'); assert.equal(c.money(), Number.MAX_SAFE_INTEGER);
});
test('currency subtract floors at zero and corrupt balances require explicit repair', () => {
    const c = setup(); click(c, 'currency', '0', '100', 'subtract'); assert.equal(c.money(), 0);
    for (const invalid of [Infinity, NaN, -Infinity]) {
        c.money(invalid); click(c, 'currency', '0', '10'); assert.ok(Object.is(c.money(), invalid));
        click(c, 'currency', '0', '10', 'repair'); assert.equal(c.money(), 10);
    }
    click(c, 'currency', '0', '5', 'repair'); assert.equal(c.money(), 10);
});
test('balls and berries grants do not count as purchases or harvests', () => {
    const c = setup(); click(c, 'pokeballs', '0', '2'); click(c, 'berries', '0', '2');
    assert.equal(c.ball(), 6); assert.equal(c.berry(), 5);
    c.item(Number.MAX_SAFE_INTEGER); click(c, 'heldItems', 'Lucky_egg', '1'); assert.equal(c.item(), Number.MAX_SAFE_INTEGER);
});
test('pokedex includes forms with computed native regions and filters exact region and name', () => {
    const c = setup(); c.d.querySelector('[data-debug-action="loadPkdx"]').click();
    assert.equal(c.d.querySelectorAll('#pkdx tbody tr').length, 2);
    const region = c.d.getElementById('pkdxRegionFilter'); region.value = 'kanto'; region.dispatchEvent(new c.w.Event('input', {bubbles: true}));
    assert.equal(c.d.getElementById('pkdx_1').style.display, '');
    assert.equal(c.d.getElementById('pkdx_1_01').style.display, 'none');
    region.value = 'all'; const name = c.d.getElementById('pkdxNameFilter'); name.value = 'BULBA'; name.dispatchEvent(new c.w.Event('input', {bubbles: true}));
    assert.equal(c.d.getElementById('pkdx_1').style.display, '');
    c.d.querySelector('#pkdx_1 [data-debug-action="gainPk"]').click(); assert.equal(c.party.has(1), true);
});
test('native reward statistics cannot overflow even when the inventory total is safe', () => {
    const c = setup();
    c.game.statistics = {totalMoney: o(Number.MAX_SAFE_INTEGER), totalGemsGained: o(Infinity), gemsGained: [o(0)], pokeballsObtained: [o(Number.MAX_SAFE_INTEGER)], totalBerriesObtained: o(0), berriesObtained: [o(Number.MAX_SAFE_INTEGER)]};
    click(c, 'currency', '0', '1'); assert.equal(c.money(), 10);
    click(c, 'gems', '0', '1'); assert.equal(c.gem(), 5);
    click(c, 'pokeballs', '0', '1'); assert.equal(c.ball(), 4);
    click(c, 'berries', '0', '1'); assert.equal(c.berry(), 3);
    // Removing money does not increase earned statistics.
    click(c, 'currency', '0', '100', 'subtract'); assert.equal(c.money(), 0);
});
test('native unique item and locked gem rules report the actual applied delta', () => {
    const c = setup(); c.item(0);
    click(c, 'items', 'Key_stone', '20'); assert.equal(c.item(), 1);
    assert.match(c.d.getElementById('debug-cheats-status').textContent, /Applied 1/);
    c.game.gems.gainGems = () => {};
    click(c, 'gems', '0', '5'); assert.equal(c.gem(), 5);
    assert.match(c.d.getElementById('debug-cheats-status').textContent, /Applied 0/);
});
test('pokedex reload refreshes newly reached regions and preserves a still valid filter', () => {
    const c = setup();
    const region = c.d.getElementById('pkdxRegionFilter'); region.value = 'kanto';
    c.w.GameConstants.Region[2] = 'hoenn'; c.w.GameConstants.Region.hoenn = 2;
    c.w.player.highestRegion = () => 2;
    c.w.pokemonList.push({id: 252, name: 'Treecko'});
    c.w.PokemonHelper.calcNativeRegion = name => name === 'Treecko' ? 2 : name === 'Johto Form' ? 1 : 0;
    c.d.querySelector('[data-debug-action="loadPkdx"]').click();
    assert.equal(region.value, 'kanto');
    assert.ok([...region.options].some(option => option.value === 'hoenn'));
    region.value = 'hoenn'; region.dispatchEvent(new c.w.Event('input', {bubbles: true}));
    assert.equal(c.d.getElementById('pkdx_252').style.display, '');
    assert.equal(c.d.getElementById('pkdx_1').style.display, 'none');
    c.w.player.highestRegion = () => 1;
    c.d.querySelector('[data-debug-action="loadPkdx"]').click();
    assert.equal(region.value, 'all');
    assert.equal(c.d.getElementById('pkdx_1').style.display, '');
});
test('Pokerus action never lowers resistant status or existing effort points', () => {
    const c = setup();
    const pokemon = {shiny: false, pokerus: 3, effortPoints: 1000000};
    c.party.set(1, pokemon);
    c.d.querySelector('[data-debug-action="loadPkdx"]').click();
    const action = c.d.querySelector('#pkdx_1 [data-debug-action="gainPkrs"]');
    action.click(); assert.equal(pokemon.pokerus, 3); assert.equal(pokemon.effortPoints, 1000000);
    pokemon.pokerus = 2; action.click(); assert.equal(pokemon.pokerus, 3); assert.equal(pokemon.effortPoints, 1000000);
    pokemon.pokerus = 0; pokemon.effortPoints = 2000; action.click(); assert.equal(pokemon.pokerus, 2); assert.equal(pokemon.effortPoints, 2000);
});
test('looping Pokemon shop grants and duplicate currency-backed item aliases are excluded', () => {
    let rolls = 0;
    const c = setup(true, w => {
        w.PokemonItem = class {constructor() {this.name = 'Shop_Mon';} gain(amount) {for (let i = 0; i < amount; i++) rolls++; w.App.game.party.gainPokemonById(1);}};
        w.PokeballItem = class {constructor() {this.name = 'Pokeball';} gain(amount) {w.App.game.pokeballs.gainPokeballs(0, amount, true);}};
        w.ItemList.Shop_Mon = new w.PokemonItem(); w.player.itemList.Shop_Mon = o(0);
        w.ItemList.Pokeball = new w.PokeballItem(); w.player.itemList.Pokeball = o(0);
    });
    assert.equal(c.d.querySelector('[data-debug-kind="items"][data-debug-key="Shop_Mon"]'), null);
    assert.equal(c.d.querySelector('[data-debug-kind="items"][data-debug-key="Pokeball"]'), null);
    assert.equal(rolls, 0);
    assert.ok(c.d.querySelector('[data-debug-kind="pokeballs"][data-debug-key="0"]'));
});
test('mulch and shovels check their native inventory instead of unused player-item counters', () => {
    const mulch = o(20), shovel = o(Number.MAX_SAFE_INTEGER), mulchShovel = o(7);
    const c = setup(true, w => {
        Object.assign(w.App.game.farming, {mulchList: [mulch], shovelAmt: shovel, mulchShovelAmt: mulchShovel});
        w.MulchItem = class {constructor() {this.name = 'Rich_Mulch';this.type = 0;} gain(n) {mulch(mulch() + n);}};
        w.ShovelItem = class {constructor() {this.name = 'Berry_Shovel';} gain(n) {shovel(shovel() + n);}};
        w.MulchShovelItem = class {constructor() {this.name = 'Mulch_Shovel';} gain(n) {mulchShovel(mulchShovel() + n);}};
        for (const constructor of [w.MulchItem, w.ShovelItem, w.MulchShovelItem]) {const item = new constructor();w.ItemList[item.name] = item; w.player.itemList[item.name] = o(0);}
    });
    click(c, 'items', 'Rich_Mulch', '4'); assert.equal(mulch(), 24); assert.match(c.d.getElementById('debug-cheats-status').textContent, /Applied 4/);
    click(c, 'items', 'Berry_Shovel', '1'); assert.equal(shovel(), Number.MAX_SAFE_INTEGER);
    click(c, 'items', 'Mulch_Shovel', '3'); assert.equal(mulchShovel(), 10); assert.match(c.d.getElementById('debug-cheats-status').textContent, /Applied 3/);
});
test('inventory grants have a visible one-million cap and vitamins guard both native totals', () => {
    const vitamin = o(0);
    const c = setup(true, w => {
        w.Vitamin = class {constructor() {this.name = 'Protein';} gain(n) {vitamin(vitamin() + n);}};
        w.ItemList.Protein = new w.Vitamin(); w.player.itemList.Protein = vitamin;
        w.GameConstants.VitaminType = {Protein: 0, 0: 'Protein'};
        w.App.game.statistics = {totalVitaminsObtained: o(Number.MAX_SAFE_INTEGER), totalVitaminsPurchased: o(0)};
    });
    click(c, 'vitamins', 'Protein', '1'); assert.equal(vitamin(), 0);
    click(c, 'heldItems', 'Lucky_egg', '1000001'); assert.equal(c.item(), 2);
    assert.equal(c.d.getElementById('inputAddHeldItems').max, '1000000');
    click(c, 'currency', '0', '1000001'); assert.equal(c.money(), 1000011);
});
test('berry and Oak shop aliases are excluded even when their classes are not globals', () => {
    const c = setup(true, w => {
        // Native classes are module-private. Their public fields link to the native catalogs.
        class BerryItem {
            constructor(name, berry) {Object.assign(this, {name: `${name}Berry`, berry, berryName: name});}
            gain(amount) {w.App.game.farming.gainBerry(this.berry, amount, false);}
        }
        class BuyOakItem {
            constructor(name, item) {Object.assign(this, {name, item});}
            gain() {w.App.game.oakItems.itemList[this.item].purchased = true;}
        }
        for (const [index, name] of ['Chople', 'Kebia', 'Shuca', 'Charti'].entries()) {
            const berry = index + 1;
            w.BerryType[berry] = name; w.BerryType[name] = berry;
            w.App.game.farming.berryInventory[berry] = o(0);
            w.ItemList[`${name}Berry`] = new BerryItem(name, berry);
            w.player.itemList[`${name}Berry`] = o(0);
        }
        w.App.game.oakItems = {itemList: []};
        for (const [index, name] of ['Squirtbottle', 'Sprinklotad', 'Explosive_Charge', 'Treasure_Scanner'].entries()) {
            w.App.game.oakItems.itemList[index] = {name: index, purchased: false};
            w.ItemList[name] = new BuyOakItem(name, index); w.player.itemList[name] = o(0);
        }
    });
    assert.equal(typeof c.w.BerryItem, 'undefined'); assert.equal(typeof c.w.BuyOakItem, 'undefined');
    for (const key of ['ChopleBerry', 'KebiaBerry', 'ShucaBerry', 'ChartiBerry', 'Squirtbottle', 'Sprinklotad', 'Explosive_Charge', 'Treasure_Scanner']) {
        assert.equal(c.d.querySelector(`[data-debug-kind="items"][data-debug-key="${key}"]`), null, key);
    }
    assert.ok(c.d.querySelector('[data-debug-kind="berries"][data-debug-key="1"]'));
    assert.equal(c.game.oakItems.itemList[0].purchased, false);
});
