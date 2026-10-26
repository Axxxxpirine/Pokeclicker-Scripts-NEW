const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

// Values and call signatures checked against Pokéclicker 0.10.26.
const constants = { SHINY_CHANCE_BATTLE: 8192, SHINY_CHANCE_DUNGEON: 4096,
    SHINY_CHANCE_STONE: 2048, SHINY_CHANCE_SAFARI: 1024, SHINY_CHANCE_SHOP: 1024,
    SHINY_CHANCE_BATTLEFRONTIER: 1024, SHINY_CHANCE_BREEDING: 1024,
    SHINY_CHANCE_FARM: 1024, SHINY_CHANCE_REWARD: 1024 };

function setup(options = {}) {
    const rolls = [], charms = [];
    let result = false;
    const App = { isUsingClient: true, game: {
        multiplier: { getBonus: () => options.bonus ?? 2 },
        oakItems: { use: item => charms.push(item) },
    } };
    const Rand = { chance: chance => { rolls.push(chance); return result; } };
    const PokemonFactory = {
        // The native method, including its bonus and charm accounting.
        generateShiny(chance, skipBonus = false) {
            const bonus = skipBonus ? 1 : App.game.multiplier.getBonus('shiny');
            if (Rand.chance(chance / bonus)) {
                App.game.oakItems.use('Shiny_Charm');
                return true;
            }
            return false;
        },
        generateWildPokemon() { return this.generateShiny(constants.SHINY_CHANCE_BATTLE); },
        generateDungeonPokemon() { return this.generateShiny(constants.SHINY_CHANCE_DUNGEON); },
        generateDungeonBoss() { return this.generateShiny(constants.SHINY_CHANCE_DUNGEON); },
        generateDungeonTrainerPokemon() { return this.gymPokemonToBattlePokemon({}, 0, constants.SHINY_CHANCE_DUNGEON); },
        gymPokemonToBattlePokemon(pokemon, encounter, chance = constants.SHINY_CHANCE_BATTLE) { return this.generateShiny(chance); },
        generateWandererData() { return this.generateShiny(constants.SHINY_CHANCE_FARM); },
    };
    class SafariPokemon {
        constructor() { this.shiny = PokemonFactory.generateShiny(constants.SHINY_CHANCE_SAFARI); }
        static random() { return new SafariPokemon(); }
    }
    class Egg {
        constructor(chance = 128) { this.shinyChance = chance; this.steps = () => 0; }
        // Native 0.10.26 weighted per-step bonus, retained on the egg until hatch.
        updateShinyChance(steps, multiplier) {
            const stepsChance = constants.SHINY_CHANCE_BREEDING / multiplier.getBonus('shiny');
            this.shinyChance = ((this.shinyChance * this.steps()) + (stepsChance * steps)) / (this.steps() + steps);
        }
        hatch(baby = false) {
            const shiny = PokemonFactory.generateShiny(this.shinyChance, true);
            if (baby) PokemonFactory.generateShiny(constants.SHINY_CHANCE_BREEDING);
            if (options.hatchThrows) throw new Error('hatch failed');
            return shiny;
        }
    }
    class Player { pickStarter() { return PokemonFactory.generateShiny(constants.SHINY_CHANCE_SHOP); } }
    class PokemonItem { gain(amount) { for (let i = 0; i < amount; i++) PokemonFactory.generateShiny(constants.SHINY_CHANCE_SHOP); } }
    class DiscordCode { claim() { return PokemonFactory.generateShiny(constants.SHINY_CHANCE_SHOP); } }
    class GiftNPC { acceptGift() { return PokemonFactory.generateShiny(constants.SHINY_CHANCE_REWARD); } }
    class Quest { claim() { return PokemonFactory.generateShiny(constants.SHINY_CHANCE_REWARD); } }
    class BattleFrontierMilestone { gain() { return PokemonFactory.generateShiny(constants.SHINY_CHANCE_BATTLEFRONTIER); } }
    const EvolutionHandler = { evolve: () => PokemonFactory.generateShiny(constants.SHINY_CHANCE_STONE) };
    const native = PokemonFactory.generateShiny;
    const nativeSafari = SafariPokemon.random, nativeHatch = Egg.prototype.hatch;
    const h = load('custom/syntheticshinysynapse.user.js', '<div id="profileModal"></div><div id="startMenu"><ul><li></li></ul></div>', {
        App, Rand, PokemonFactory, SafariPokemon, Egg, Player, PokemonItem, DiscordCode, GiftNPC, Quest,
        BattleFrontierMilestone, EvolutionHandler, GameConstants: { ...constants },
        OakItemType: { Shiny_Charm: 'Shiny_Charm' },
        Error: class { constructor() { this.stack = options.stack; } },
    }, options.storage);
    for (const [key, value] of Object.entries(options.rawStorage || {})) h.w.localStorage.setItem(key, value);
    h.w.$ = () => ({ is: () => false });
    h.w.initShinySynapse();
    return { ...h, PokemonFactory, SafariPokemon, Egg, Player, PokemonItem, DiscordCode, GiftNPC, Quest,
        BattleFrontierMilestone, EvolutionHandler, native, nativeSafari, nativeHatch, rolls, charms,
        result: value => { result = value; },
        saved: key => JSON.parse(h.w.localStorage.getItem(key)),
        click: id => h.w.document.getElementById(id).click(),
    };
}

test('Karma Safari decrements only its own bucket without depending on Error.stack', () => {
    for (const stack of [undefined, 'generateShiny@game.js:1\nSafariPokemon@game.js:2', 'Error\n at generateShiny (game.js:1)\n at new SafariPokemon (game.js:2)']) {
        const h = setup({ stack, storage: { shinyKarmaMode: true } });
        assert.doesNotThrow(() => h.SafariPokemon.random());
        assert.deepEqual(h.saved('shinyKarmaRates'), [8192, 4096, 2048, 1023, 1024, 1024, 1024]);
        assert.deepEqual(h.rolls, [512]);
    }
});

test('route, dungeon trainers/bosses, stones, eggs, farm and gifts use separate buckets', () => {
    const h = setup({ storage: { shinyKarmaMode: true } });
    h.PokemonFactory.generateWildPokemon();
    h.PokemonFactory.generateDungeonPokemon(); h.PokemonFactory.generateDungeonBoss(); h.PokemonFactory.generateDungeonTrainerPokemon();
    h.EvolutionHandler.evolve(); new h.Egg().hatch(true); h.PokemonFactory.generateWandererData();
    new h.Player().pickStarter(); new h.DiscordCode().claim(); new h.GiftNPC().acceptGift();
    new h.Quest().claim(); new h.BattleFrontierMilestone().gain();
    assert.deepEqual(h.saved('shinyKarmaRates'), [8191, 4093, 2047, 1024, 1019, 1022, 1023]);
    assert.deepEqual(h.rolls.slice(5, 7), [128, 1023 / 2]);
});

test('successful shiny resets one bucket and consumes exactly one native charm use', () => {
    const h = setup({ storage: { shinyKarmaMode: true, shinyKarmaRates: [10, 20, 30, 40, 50, 60, 70] } });
    h.result(true); assert.equal(h.SafariPokemon.random().shiny, true);
    assert.deepEqual(h.charms, ['Shiny_Charm']);
    assert.deepEqual(h.saved('shinyKarmaRates'), [10, 20, 30, 1024, 50, 60, 70]);
});

test('off leaves native method identities, constants and odds unchanged, including after toggling', () => {
    const h = setup();
    assert.equal(h.PokemonFactory.generateShiny, h.native);
    assert.equal(h.SafariPokemon.random, h.nativeSafari); assert.equal(h.Egg.prototype.hatch, h.nativeHatch);
    h.click('shiny-karma-mode'); h.SafariPokemon.random(); h.click('shiny-karma-mode');
    assert.equal(h.PokemonFactory.generateShiny, h.native);
    assert.equal(h.SafariPokemon.random, h.nativeSafari); assert.equal(h.Egg.prototype.hatch, h.nativeHatch);
    new h.Egg(128).hatch(); assert.equal(h.rolls.at(-1), 128);
    assert.deepEqual(h.w.GameConstants, constants);
});

test('unknown and ambiguous contexts use native odds without touching Karma buckets', () => {
    const h = setup({ storage: { shinyKarmaMode: true } });
    const before = h.saved('shinyKarmaRates');
    for (const chance of [333, 1024]) assert.doesNotThrow(() => h.PokemonFactory.generateShiny(chance));
    assert.deepEqual(h.rolls, [166.5, 512]); assert.deepEqual(h.saved('shinyKarmaRates'), before);
});

test('mode precedence is Karma then global then category, and disabling Karma freezes progress', () => {
    const h = setup({ storage: { shinyKarmaMode: true, globalShinyState: true, globalShinyRate: 80, shinySetRates: [100, null, null, 60] } });
    h.PokemonFactory.generateWildPokemon(); assert.equal(h.rolls.at(-1), 4096);
    h.click('shiny-karma-mode'); h.SafariPokemon.random(); assert.equal(h.rolls.at(-1), 40);
    h.click('shiny-rate-global'); h.SafariPokemon.random(); assert.equal(h.rolls.at(-1), 30);
    assert.equal(h.saved('shinyKarmaRates')[0], 8191);
});

test('Karma survives reload, remains bounded at one, and restores after failed source calls', () => {
    const h = setup({ hatchThrows: true, storage: { shinyKarmaMode: true, shinyKarmaRates: [1, 1, 1, 1, 1, 1, 1] } });
    assert.throws(() => new h.Egg().hatch(), /hatch failed/);
    h.PokemonFactory.generateShiny(333);
    h.SafariPokemon.random(); h.SafariPokemon.random();
    assert.deepEqual(h.rolls, [1, 166.5, 1, 1]);
    assert.deepEqual(h.saved('shinyKarmaRates'), [1, 1, 1, 1, 1, 1, 1]);
    const next = setup({ storage: { shinyKarmaMode: true, shinyKarmaRates: h.saved('shinyKarmaRates') } });
    next.SafariPokemon.random(); assert.deepEqual(next.rolls, [1]);
});

test('corrupt saved arrays, booleans and rate values recover to finite seven-category settings', () => {
    const h = setup({ storage: { shinyKarmaMode: true, shinyKarmaRates: [null, -1, 0, 'bad', 1e100], shinySetRates: {}, globalShinyRate: null } });
    assert.deepEqual(h.saved('shinyKarmaRates'), [8192, 4096, 2048, 1024, 1024, 1024, 1024]);
    assert.deepEqual(h.saved('shinySetRates'), [null, null, null, null, null, null, null]);
    assert.equal(h.saved('globalShinyRate'), 8192);
    h.SafariPokemon.random(); assert.ok(h.rolls.every(n => Number.isFinite(n) && n >= 1));
});

test('input uses its event and rejects invalid odds without overwriting a valid setting', () => {
    const h = setup(); const input = h.w.document.getElementById('shiny-modifier-global');
    input.value = '64'; input.dispatchEvent(new h.w.Event('input')); input.parentElement.querySelector('button').click();
    assert.equal(h.saved('globalShinyRate'), 64);
    for (const value of ['', '0', '-5', 'Infinity', '1e100', 'NaN']) {
        input.value = value; input.parentElement.querySelector('button').click();
        assert.equal(h.saved('globalShinyRate'), 64);
    }
    h.click('shiny-rate-global'); h.PokemonFactory.generateShiny(333); assert.equal(h.rolls.at(-1), 32);
});

test('malformed JSON recovers at initialization and repeated initialization is inert', () => {
    const h = setup({ rawStorage: { shinyKarmaRates: '[NaN]', shinySetRates: '{', globalShinyRate: 'Infinity',
        shinyKarmaMode: '"true"', globalShinyState: 'garbage', shinyDOMUpdate: '{}' } });
    assert.equal(h.PokemonFactory.generateShiny, h.native);
    assert.equal(h.saved('shinyKarmaMode'), false); assert.equal(h.saved('globalShinyState'), false);
    assert.equal(h.saved('shinyDOMUpdate'), false); assert.equal(h.saved('globalShinyRate'), 8192);
    h.w.initShinySynapse();
    assert.equal(h.w.document.querySelectorAll('#shinyModal').length, 1);
    assert.equal(h.w.document.querySelectorAll('.shiny-modifier-view').length, 8);
    assert.equal(h.timers.size, 0);
});

test('saved progress reloads and reset removes category hooks without resetting Karma', () => {
    const h = setup({ storage: { shinyKarmaMode: true } });
    h.PokemonFactory.generateWildPokemon(); h.SafariPokemon.random();
    const next = setup({ storage: { shinyKarmaMode: true, shinyKarmaRates: h.saved('shinyKarmaRates') } });
    next.SafariPokemon.random(); assert.equal(next.rolls.at(-1), 1023 / 2);
    next.click('shiny-karma-mode');
    const input = next.w.document.getElementById('shiny-modifier-3');
    input.value = '12'; input.parentElement.querySelector('button').click();
    next.SafariPokemon.random(); assert.equal(next.rolls.at(-1), 6);
    next.click('shiny-rates-reset');
    assert.equal(next.PokemonFactory.generateShiny, next.native);
    assert.equal(next.saved('shinyKarmaRates')[3], 1022);
});

test('bounded denominator applies bonus once and stays finite for extreme bonus values', () => {
    for (const bonus of [0, -1, Infinity, NaN, Number.MIN_VALUE, Number.MAX_VALUE]) {
        const h = setup({ bonus, storage: { globalShinyState: true, globalShinyRate: Number.MAX_SAFE_INTEGER } });
        h.PokemonFactory.generateShiny(333);
        assert.ok(h.rolls.every(n => Number.isFinite(n) && n >= 1 && n <= Number.MAX_SAFE_INTEGER));
    }
    const h = setup({ storage: { globalShinyState: true, globalShinyRate: 12 } });
    new h.Egg().hatch(true); assert.deepEqual(h.rolls, [1.5, 6]);
});

test('a later third-party wrapper survives disable and does not duplicate Karma after re-enable', () => {
    const h = setup({ storage: { shinyKarmaMode: true } });
    const earlier = h.PokemonFactory.generateShiny;
    const thirdParty = function (...args) { return earlier.apply(this, args); };
    h.PokemonFactory.generateShiny = thirdParty;
    h.click('shiny-karma-mode'); assert.equal(h.PokemonFactory.generateShiny, thirdParty);
    h.click('shiny-karma-mode'); h.SafariPokemon.random();
    assert.deepEqual(h.rolls, [512]);
    assert.equal(h.saved('shinyKarmaRates')[3], 1023);
});

test('shop PokemonItem.gain accounts for every native roll in a multi-purchase', () => {
    const h = setup({ storage: { shinyKarmaMode: true } });
    new h.PokemonItem().gain(3);
    assert.deepEqual(h.rolls, [512, 1023 / 2, 511]);
    assert.equal(h.saved('shinyKarmaRates')[4], 1021);
});

test('Karma preserves an egg’s historical shiny multiplier rather than the current multiplier', () => {
    const h = setup({ bonus: 64, storage: { shinyKarmaMode: true } });
    const egg = new h.Egg(constants.SHINY_CHANCE_BREEDING);
    egg.updateShinyChance(100, { getBonus: () => 8 });
    assert.equal(egg.shinyChance, 128);
    egg.hatch(); egg.hatch(true);
    assert.deepEqual(h.rolls, [128, 1023 / 8, 1022 / 64]);
    assert.equal(h.saved('shinyKarmaRates')[5], 1021);
});

test('global and breeding odds preserve weighted egg bonuses and exact single native charm use', () => {
    for (const storage of [{ globalShinyState: true, globalShinyRate: 512 }, { shinySetRates: [null,null,null,null,null,512] }]) {
        const h = setup({ bonus: 16, storage });
        const egg = new h.Egg(constants.SHINY_CHANCE_BREEDING);
        egg.updateShinyChance(100, { getBonus: () => 8 });
        egg.steps = () => 100;
        egg.updateShinyChance(100, { getBonus: () => 4 });
        assert.equal(egg.shinyChance, 192);
        h.result(true); egg.hatch();
        assert.deepEqual(h.rolls, [96]); assert.deepEqual(h.charms, ['Shiny_Charm']);
    }
});

test('an unchanged egg keeps its pre-applied bonus when another category override is active', () => {
    const h = setup({ storage: { shinySetRates: [40] } });
    new h.Egg(128).hatch(); new h.Egg(0.5).hatch();
    assert.deepEqual(h.rolls, [128, 1]);
});
