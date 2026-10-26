// ==UserScript==
// @name          [Pokeclicker] Debug Cheats Tools
// @namespace     Pokeclicker Scripts
// @author        kevingrillet
// @description   Edit your save for debug (currency, gems, pokeballs, pokemons, ...)
// @copyright     https://github.com/Ephenia
// @license       GPL-3.0 License
// @version       1.1.1

// @homepageURL   https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/
// @supportURL    https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/issues
// @downloadURL   https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/debugcheatstools.user.js
// @updateURL     https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/custom/debugcheatstools.user.js

// @match         https://www.pokeclicker.com/
// @icon          https://www.google.com/s2/favicons?domain=pokeclicker.com
// @grant         unsafeWindow
// @run-at        document-idle
// ==/UserScript==
// Modified by Axxxxpirine, 2026-10-27: fork maintenance and installation/update URLs.
// Includes this fork's compatibility and feature changes where applicable.
// Original authorship and GPL-3.0 licensing are retained.

// This script has many more cheats, but it's already too much... https://greasyfork.org/en/scripts/435557-pokeclicker


function getPokerusImgSrc(id, pkm){
    let lpkm = pkm || App.game.party.getPokemon(id);
    return lpkm?.pokerus || 0 > 0 ? (lpkm.pokerus === 3 ? "assets/images/breeding/pokerus/Resistant.png" : "assets/images/breeding/pokerus/Contagious.png") : "assets/images/breeding/pokerus/Infected.png";
}

function getPokeballImgSrc(id, pkm){
    let lpkm = pkm || App.game.party.getPokemon(id);
    return lpkm ? ((lpkm?.shiny === true) ? "assets/images/pokeball/Pokeball-shiny.svg" : "assets/images/pokeball/Pokeball.svg") : "assets/images/pokeball/None.svg";
}

// eslint-disable-next-line no-unused-vars
function gainPk(id){
    let lpkm = App.game.party.getPokemon(id);
    if (!lpkm)
        App.game.party.gainPokemonById(id)
    else if (!(lpkm?.shiny === true))
        App.game.party.gainPokemonById(id, true);
    document.querySelectorAll(`:scope #pkdx_${id.toString().replace('.','_')} img`)[1].src = getPokeballImgSrc(id);
}

// eslint-disable-next-line no-unused-vars
function gainPkrs(id){
    let lpkm = App.game.party.getPokemon(id);
    if (!lpkm || lpkm.pokerus >= GameConstants.Pokerus.Resistant) return;
    const nextStatus = lpkm.pokerus < GameConstants.Pokerus.Contagious ? GameConstants.Pokerus.Contagious : GameConstants.Pokerus.Resistant;
    const minimumEffortPoints = nextStatus === GameConstants.Pokerus.Contagious ? 1000 : 50000;
    lpkm.pokerus = nextStatus;
    // Preserve earned EV progress. Set status first so native EP subscriptions
    // can advance it further without being overwritten by this action.
    lpkm.effortPoints = Math.max(lpkm.effortPoints ?? 0, minimumEffortPoints);
    document.querySelectorAll(`:scope #pkdx_${id.toString().replace('.','_')} img`)[2].src = getPokerusImgSrc(id, lpkm);
}

function filterPkdx(){
    let lst = document.querySelectorAll(':scope #pkdx tbody tr');
    for (let i = 0; i < lst.length; i++) {
        const tdb = lst[i];
        let display = true;

        if (document.getElementById('pkdxNameFilter').value !== ""){
            display = tdb.dataset.name.includes(document.getElementById('pkdxNameFilter').value.trim().toLowerCase());
        }

        if (display === true) {
            switch (document.getElementById('pkdxRegionFilter').value) {
                case 'all':
                    break;
                default:
                    display = tdb.dataset.region === document.getElementById('pkdxRegionFilter').value;
                    break;
            }
        }

        if (display === true) {
            switch (document.getElementById('pkdxShinyFilter').value) {
                case 'uncaught':
                    display = tdb.innerHTML.includes('None.svg');
                    break;
                case 'caught':
                    display = tdb.innerHTML.includes('Pokeball.svg') || tdb.innerHTML.includes('Pokeball-shiny.svg');
                    break;
                case 'caught-not-shiny':
                    display = tdb.innerHTML.includes('Pokeball.svg');
                    break;
                case 'caught-shiny':
                    display = tdb.innerHTML.includes('Pokeball-shiny.svg');
                    break;
                default:
                    break;
            }
        }

        if (display === true) {
            switch (document.getElementById('pkdxPKRSFilter').value) {
                case '0':
                    display = tdb.innerHTML.includes('Infected.png');
                    break;
                case '2':
                    display = tdb.innerHTML.includes('Contagious.png');
                    break;
                case '3':
                    display = tdb.innerHTML.includes('Resistant.png');
                    break;
                default:
                    break;
            }
        }

        tdb.style.display = (display === true ? "" : "none");
    }
}

function filterQuestLine(){
    let lst = document.querySelectorAll(':scope #questlinelist tbody tr');
    for (let i = 0; i < lst.length; i++) {
        const tdb = lst[i];
        let display = true;

        if (display === true) {
            switch (document.getElementById('questLineFilter').value) {
                case 'all':
                    break;
                default:
                    display = tdb.innerHTML.toLowerCase().includes(document.getElementById('questLineFilter').value);
                    break;
            }
        }

        tdb.style.display = (display === true ? "" : "none");
    }
}

// eslint-disable-next-line no-unused-vars
function loadPkdx(){
    refreshDebugRegions();
    let playerRegion = player.highestRegion();
    let pkdxBody = document.querySelector(':scope #pkdx tbody');
    pkdxBody.innerHTML = '';
    let toAdd = "";
    for (const pokemon of pokemonList) {
        const nativeRegion = PokemonHelper.calcNativeRegion(pokemon.name);
        if (nativeRegion <= playerRegion) {
            let lpkm = App.game.party.getPokemon(pokemon.id);
            const regionName = GameConstants.Region[nativeRegion] || 'none';
            const region = regionName.charAt(0).toUpperCase() + regionName.slice(1);
            let hint = "";
            let getPokemonLocation = PokemonLocations.getPokemonLocations(pokemon.name, playerRegion);
            let roadLocations = getPokemonLocation[0]
            if (roadLocations) {
                for (let i = 0; i <= playerRegion; i++) {
                    const reg = GameConstants.Region[i];
                    let roads = "Route"
                    roadLocations[i]?.forEach((route) => {
                        roads += ` ${route.route},`
                    });
                    if (roads !== "Route")
                        hint += `${hint !== "" ? `\n` : ""}${reg.charAt(0).toUpperCase() + reg.slice(1)}: ${roads.slice(0, -1)}`;
                }
                if (hint !== "")
                    hint = ` title="${hint}"`;
            }
            toAdd += `
                <tr id="pkdx_${pokemon.id.toString().replace('.','_')}" data-name="${debugEscape(pokemon.name.toLowerCase())}" data-region="${regionName}">
                    <td>${pokemon.id}</td>
                    <td>${region}</td>
                    <td><img class="smallImage" src="assets/images/pokemon/${pokemon.id}.png" alt=""></td>
                    <td>${debugEscape(pokemon.name)}</td>
                    <td><img width="18px" src="${getPokeballImgSrc(pokemon.id, lpkm)}" data-debug-action="gainPk" data-debug-id="${pokemon.id}"/></td>
                    <td><img src="${getPokerusImgSrc(pokemon.id, lpkm)}"  data-debug-action="gainPkrs" data-debug-id="${pokemon.id}"/></td>
                    <td${hint}><span class="badge text-light" style="background-color: rgb(${Object.keys(getPokemonLocation).length ? ((hint !== "" ? (hint.includes(region) ? '122, 199, 76'  : '166, 185, 26' ) : '99, 144, 240') + ');">YES') : '194, 46, 40);">NO'}</span></td>
                </tr>
            `;
        }
    }
    pkdxBody.innerHTML = toAdd;
    filterPkdx();
}

function loadQuestLines() {
    let qlBody = document.querySelector(':scope #questlinelist tbody');
    qlBody.innerHTML = '';
    let toAdd = "";

    for (const ql of App.game.quests.questLines()) {
        let state = QuestLineState[ql.state()]
        state = state.charAt(0).toUpperCase() + state.slice(1)

        let stateColor;
        switch (ql.state()) {
            case 0:
                stateColor = "244, 80, 80";
                break;
            case 1:
                stateColor = "99, 144, 240";
                break;
            case 2:
                stateColor = "122, 199, 76";
                break;
        }

        toAdd += `
			<tr id="ql_${ql.name.toString().replace('.','_')}">
				<td>${ql.name}</td>
				<td><span class="badge text-light" style="background-color: rgb(${stateColor})">${state}</span></td>
			</tr>
		`;
    }

    // App.game.quests.questLines().filter(e => e.state() < 2).forEach(e => console.log(e.name, e.state()))

    qlBody.innerHTML = toAdd;
    filterQuestLine();
}

function refreshDebugRegions() {
    const select = document.getElementById('pkdxRegionFilter');
    const previous = select.value;
    select.innerHTML = '<option value="all">All</option>';
    // Rebuild on each reload so newly reached regions and their forms are selectable.
    const regions = [...new Set(pokemonList.map(p => PokemonHelper.calcNativeRegion(p.name)))].filter(r => r <= player.highestRegion()).sort((a, b) => a - b);
    for (const id of regions) {
        const region = GameConstants.Region[id] || 'none';
        const option = document.createElement('option');
        option.value = region;
        option.textContent = region.charAt(0).toUpperCase() + region.slice(1);
        select.append(option);
    }
    select.value = [...select.options].some(option => option.value === previous) ? previous : 'all';
}

function debugEscape(value) {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function debugInventoryBalance(item) {
    // Shop transactions that grant Pokémon, balls, berries or unlocks are not
    // ordinary player.itemList inventories. Their dedicated controls are explicit.
    const transactions = [
        typeof PokemonItem === 'function' ? PokemonItem : null,
        typeof PokeballItem === 'function' ? PokeballItem : null,
        typeof BuyKeyItem === 'function' ? BuyKeyItem : null,
    ];
    if (transactions.some(type => type && item instanceof type)) return null;
    // BerryItem and BuyOakItem are module-private in 0.10.26. Identify their
    // public catalog references instead of relying on nonexistent globals.
    if (Number.isInteger(item.berry) && typeof BerryType[item.berry] === 'string'
        && item.name === `${BerryType[item.berry]}Berry`) return null;
    const oakItem = Number.isInteger(item.item) ? App.game.oakItems?.itemList?.[item.item] : null;
    if (oakItem && oakItem.name === item.item && typeof oakItem.purchased === 'boolean') return null;
    if (typeof MulchItem === 'function' && item instanceof MulchItem) return App.game.farming.mulchList[item.type];
    if (typeof ShovelItem === 'function' && item instanceof ShovelItem) return App.game.farming.shovelAmt;
    if (typeof MulchShovelItem === 'function' && item instanceof MulchShovelItem) return App.game.farming.mulchShovelAmt;
    return player.itemList[item.name];
}

function debugCatalog(kind) {
    const game = App.game;
    const list = (values, names, image, gain) => Object.entries(values || {}).filter(([id, balance]) => Number(id) >= 0 && typeof balance === 'function' && names[id]).map(([id, balance]) => ({ key: id, name: names[id], image: image(names[id]), balance, gain: amount => gain(Number(id), amount) }));
    switch (kind) {
        case 'currency': return list(game.wallet?.currencies, GameConstants.Currency, name => `assets/images/currency/${name}.svg`, (id, amount) => game.wallet.addAmount(new Amount(amount, id), true));
        case 'gems': return list(game.gems?.gemWallet, PokemonType, name => `assets/images/gems/${name} Gem.png`, (id, amount) => game.gems.gainGems(amount, id));
        case 'pokeballs': return list((game.pokeballs?.pokeballs || []).map(ball => ball.quantity), GameConstants.Pokeball, name => `assets/images/pokeball/${name}.svg`, (id, amount) => game.pokeballs.gainPokeballs(id, amount, false));
        case 'berries': return list(game.farming?.berryInventory, BerryType, name => `assets/images/items/berry/${name}.png`, (id, amount) => game.farming.gainBerry(id, amount, false));
        case 'keyItems': return (game.keyItems?.itemList || []).map(item => ({ key: String(item.id), name: item.displayName || KeyItemType[item.id]?.replaceAll('_', ' ') || item.name, gain: () => game.keyItems.gainKeyItem(item.id), unlocked: () => item.isUnlocked() }));
        case 'underground': return (typeof UndergroundItems === 'undefined' ? [] : UndergroundItems.list).filter(item => typeof player.itemList[item.itemName] === 'function').map(item => ({ key: String(item.id), name: item.displayName || item.itemName.replaceAll('_', ' '), image: item.image, balance: player.itemList[item.itemName], gain: amount => UndergroundController.gainMineItem(item.id, amount) }));
        default: return Object.entries(ItemList).filter(([key, item]) => {
            if (typeof item.gain !== 'function' || typeof debugInventoryBalance(item) !== 'function') return false;
            if (kind === 'heldItems') return item instanceof HeldItem;
            if (kind === 'evolutionitems') return Number.isInteger(GameConstants.StoneType[key]) && GameConstants.StoneType[key] >= 0;
            if (kind === 'vitamins') return Number.isInteger(GameConstants.VitaminType[key]) && GameConstants.VitaminType[key] >= 0;
            return kind === 'items';
        }).map(([key, item]) => ({ key, name: item.displayName || item.name.replaceAll('_', ' '), image: item.image, balance: debugInventoryBalance(item), gain: amount => item.gain(amount), vitamin: Number.isInteger(GameConstants.VitaminType[key]) && GameConstants.VitaminType[key] >= 0 }));
    }
}

function debugApply(kind, key, input, operation) {
    const status = document.getElementById('debug-cheats-status');
    const report = message => { status.textContent = message; };
    const resource = debugCatalog(kind).find(item => item.key === key);
    if (!resource) return report('This resource is unavailable.');
    if (kind === 'keyItems') {
        if (resource.unlocked()) return report(`${resource.name} is already unlocked.`);
        resource.gain();
        return report(`${resource.name} unlocked.`);
    }
    const amount = typeof input === 'string' && input.trim() !== '' ? Number(input) : NaN;
    if (!Number.isSafeInteger(amount) || amount < 0 || (amount === 0 && operation !== 'repair')) return report('Enter a positive, finite whole amount within the safe integer range.');
    if (kind !== 'currency' && amount > 1000000) return report('Inventory grants are limited to 1,000,000 per click.');
    const before = resource.balance();
    const validBalance = Number.isFinite(before) && before >= 0 && before <= Number.MAX_SAFE_INTEGER;
    if (kind === 'currency' && operation === 'repair') {
        if (validBalance) return report('This balance is valid. Repair only replaces invalid balances.');
        // An explicit repair replaces only the selected corrupt balance, without inventing earned statistics.
        resource.balance(amount);
        return report(`${resource.name} repaired to ${amount}.`);
    }
    if (!validBalance) return report('Invalid balance. Currency balances can be replaced using Repair invalid balance.');
    if (kind === 'currency' && operation === 'subtract') {
        const remove = Math.min(before, amount);
        if (remove > 0) App.game.wallet.loseAmount(new Amount(remove, Number(key)));
        return report(`Removed ${remove} ${resource.name}.`);
    }
    if (operation !== 'add' || !Number.isFinite(before + amount) || before + amount > Number.MAX_SAFE_INTEGER || before + amount <= before) return report('The resulting total is outside the safe range.');
    // Native gain methods also increment lifetime totals. Refuse an unsafe addition
    // before either inventory or statistics is touched.
    const statistics = App.game.statistics;
    let totals = [];
    if (statistics) {
        if (kind === 'currency') {
            const names = { money: 'totalMoney', dungeonToken: 'totalDungeonTokens', questPoint: 'totalQuestPoints', diamond: 'totalDiamonds', farmPoint: 'totalFarmPoints', battlePoint: 'totalBattlePoints', contestToken: 'totalContestTokens' };
            totals = [statistics[names[GameConstants.Currency[key]]]];
        } else if (kind === 'gems') totals = [statistics.totalGemsGained, statistics.gemsGained?.[key]];
        else if (kind === 'pokeballs') totals = [statistics.pokeballsObtained?.[key]];
        else if (kind === 'berries') totals = [statistics.totalBerriesObtained, statistics.berriesObtained?.[key]];
        else if (resource.vitamin) totals = [statistics.totalVitaminsObtained, statistics.totalVitaminsPurchased];
    }
    if (totals.some(total => typeof total === 'function' && (!Number.isFinite(total()) || total() < 0 || total() + amount > Number.MAX_SAFE_INTEGER))) return report('A lifetime statistic is invalid or would exceed the safe range. Nothing was added.');
    resource.gain(amount);
    report(`Applied ${resource.balance() - before} to ${resource.name}.`);
}

function initSaveEditor() {
    if (document.getElementById('saveEditorModal')) return;
    const profileDrop = document.getElementById('startMenu')?.querySelector('ul li');
    const profileModal = document.getElementById('profileModal');
    if (!profileDrop || !profileModal) return;

    // Add menu item
    let eventLi = document.createElement('li');
    eventLi.innerHTML = `<a class="dropdown-item" href="#saveEditorModal" data-toggle="modal">Debug Cheats</a>`
    profileDrop.before(eventLi);

    // Add popup
    let eventMod = document.createElement('div');
    eventMod.setAttribute("class", "modal noselect fade show");
    eventMod.setAttribute("id", "saveEditorModal");
    eventMod.setAttribute("tabindex", "-1");
    eventMod.setAttribute("aria-labelledby", "saveEditorModal");
    eventMod.setAttribute("aria-modal", "true");
    eventMod.setAttribute("role", "dialog");

    eventMod.innerHTML = `
        <div class="modal-dialog modal-dialog-scrollable modal-dialog-centered modal-lg" role="document">
            <div class="modal-content">
                <div class="modal-header" style="justify-content: space-around;">
                    <h5 class="modal-title">Debug Cheats Tools</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">×</span>
                    </button>
                </div>
                <div class="modal-body">
                    <ul class="nav nav-tabs nav-fill">
                        <li class="nav-item"><a data-toggle="tab" class="nav-link active" href="#currency">Currency</a></li>
                        <li class="nav-item"><a data-toggle="tab" class="nav-link" href="#gems">Gems</a></li>
                        <li class="nav-item"><a data-toggle="tab" class="nav-link" href="#pokeballs">Pokeballs</a></li>
                        <li class="nav-item"><a data-toggle="tab" class="nav-link" href="#berries">Berries</a></li>
                        <li class="nav-item"><a data-toggle="tab" class="nav-link" href="#evolutionitems">Evolution Items</a></li>
                        <li class="nav-item"><a data-toggle="tab" class="nav-link" href="#vitamins">Vitamins</a></li>
                        <li class="nav-item"><a data-toggle="tab" class="nav-link" href="#heldItems">Held items</a></li>
                        <li class="nav-item"><a data-toggle="tab" class="nav-link" href="#items">All Items</a></li>
                        <li class="nav-item"><a data-toggle="tab" class="nav-link" href="#underground">Underground</a></li>
                        <li class="nav-item"><a data-toggle="tab" class="nav-link" href="#keyItems">Key Items</a></li>
                        <li class="nav-item"><a data-toggle="tab" class="nav-link" href="#pokedex">Pokedex</a></li>
                        <li class="nav-item"><a data-toggle="tab" class="nav-link" href="#questlines">Quests</a></li>
                    </ul>
                    <div class="tab-content">
                        <div id="currency" class="tab-pane p-3 active">
                            <p>Choose an operation, enter a whole amount, then click a currency. Add grants the exact amount without bonuses. Subtract stops at zero. Repair only replaces an invalid balance with your entered value.</p>
                            <select class="custom-select" data-debug-operation aria-label="Currency operation"><option value="add">Add</option><option value="subtract">Subtract</option><option value="repair">Repair invalid balance</option></select>
                            <input id="inputAddCurrency" class="form-control" type="number" placeholder="1000000" value="1000000" min="0">
                        </div>
                        <div id="gems" class="tab-pane p-3">
                            <p>On click add gems (input)</p>
                            <input id="inputAddGems" class="form-control" type="number" placeholder="1000000" value="1000000" min="0">
                        </div>
                        <div id="pokeballs" class="tab-pane p-3">
                            <p>On click add pokeballs (input)</p>
                            <input id="inputAddPokeballs" class="form-control" type="number" placeholder="1000" value="1000" min="0">
                        </div>
                        <div id="berries" class="tab-pane p-3">
                            <p>On click add berries (input)</p>
                            <input id="inputAddBerries" class="form-control" type="number" placeholder="1000" value="1000" min="0">
                        </div>
                        <div id="evolutionitems" class="tab-pane p-3">
                            <p>On click add evolution items (input)</p>
                            <input id="inputAddEvolutionItems" class="form-control" type="number" placeholder="100" value="100" min="0">
                        </div>
                        <div id="vitamins" class="tab-pane p-3">
                            <p>On click add vitamins (input)</p>
                            <input id="inputAddVitamins" class="form-control" type="number" placeholder="100" value="100" min="0">
                        </div>
                        <div id="heldItems" class="tab-pane p-3">
                            <p>On click add held items items (input)</p>
                            <input id="inputAddHeldItems" class="form-control" type="number" placeholder="100" value="100" min="0">
                        </div>
                        <div id="items" class="tab-pane p-3"><p>Grant an item through its native gain method. Unique items keep their native limits.</p><input id="inputAddItems" aria-label="Item amount" class="form-control" type="number" value="100" min="1"></div>
                        <div id="underground" class="tab-pane p-3"><p>Grant an Underground item.</p><input id="inputAddUnderground" aria-label="Underground amount" class="form-control" type="number" value="100" min="1"></div>
                        <div id="keyItems" class="tab-pane p-3"><p>Click a key item to unlock it. Unlocking can trigger the game's rewards and progression.</p></div>
                        <div id="pokedex" class="tab-pane p-3">
                            <p><b>You can break your game, please backup!</b></br><i>Do not complete pokedex from another region if you are not in the region you will not be able to go to the next region!</i></p>
                            <button class="btn btn-primary btn-block" data-debug-action="loadPkdx">(Re)Load Data</button>
                            <div class="form-row text-left">
                                <div class="form-group col-md-6 col-6">
                                    <label for="pkdxNameFilter">Name</label>
                                    <input id="pkdxNameFilter" class="form-control" placeholder="Bulbasaur" value="" data-debug-filter="pokedex">
                                </div>
                                <div class="form-group col-md-6 col-6">
                                    <label for="pkdxRegionFilter">Region</label>
                                    <select id="pkdxRegionFilter" class="custom-select" data-debug-filter="pokedex" style="margin-right: 8px">
                                        <option value="all" selected="true">All</option>
                                    </select>
                                </div>
                                <div class="form-group col-md-6 col-6">
                                    <label for="pkdxShinyFilter">Caught Status</label>
                                    <select id="pkdxShinyFilter" autocomplete="off" class="custom-select" data-debug-filter="pokedex">
                                        <option value="all" selected="">All</option>
                                        <option value="uncaught">Uncaught</option>
                                        <option value="caught">Caught</option>
                                        <option value="caught-not-shiny">Caught not Shiny</option>
                                        <option value="caught-shiny">Caught Shiny</option>
                                    </select>
                                </div>
                                <div class="form-group col-md-6 col-6">
                                    <label for="pkdxPKRSFilter">Pokerus Status</label>
                                    <select id="pkdxPKRSFilter" autocomplete="off" class="custom-select" data-debug-filter="pokedex">
                                        <option value="-1" selected="true">All</option>
                                        <option value="0">Uninfected</option>
                                        <option value="2">Contagious</option>
                                        <option value="3">Resistant</option>
                                    </select>
                                </div>
                            </div>
                            <table id="pkdx" class="table table-striped table-hover table-sm m-0">
                                <thead>
                                    <tr>
                                        <td>#ID</td>
                                        <td>Region</td>
                                        <td>Image</td>
                                        <td>Name</td>
                                        <td>Caught</td>
                                        <td>Pokerus</td>
                                        <td>Available</td>
                                    </tr>
                                </thead>
                                <tbody>
                                </tbody>
                            </table>
                        </div>
                        <div id="questlines" class="tab-pane p-3">
                            <button class="btn btn-primary btn-block" data-debug-action="loadQuestLines">(Re)Load Data</button>
                            <div class="form-row text-left">
                                <div class="form-group col-md-6 col-6">
                                    <label for="questLineFilter">Quest Status</label>
                                    <select id="questLineFilter" autocomplete="off" class="custom-select" data-debug-filter="quests">
                                        <option value="all" selected="">All</option>
                                        <option value="inactive">Inactive</option>
                                        <option value="started">Started</option>
                                        <option value="ended">Ended</option>
                                    </select>
                                </div>
                            </div>
                            <table id="questlinelist" class="table table-striped table-hover table-sm m-0">
                                <thead>
                                    <tr>
                                        <td>Name</td>
                                        <td>Status</td>
                                    </tr>
                                </thead>
                                <tbody>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    profileModal.before(eventMod);

    let modalBody = document.querySelector('[id=saveEditorModal] div div [class=modal-body]');

    const status = document.createElement('p');
    status.id = 'debug-cheats-status';
    status.setAttribute('role', 'status');
    modalBody.prepend(status);
    const limits = document.createElement('p');
    limits.className = 'small';
    limits.textContent = 'Inventory grants: maximum 1,000,000 per click. Pokémon shop transactions are excluded. Use Pokédex actions to grant a Pokémon.';
    modalBody.prepend(limits);
    modalBody.querySelectorAll('.tab-pane input[type="number"]').forEach(input => {
        input.step = '1';
        if (input.id !== 'inputAddCurrency') input.max = '1000000';
    });
    for (const kind of ['currency', 'gems', 'pokeballs', 'berries', 'evolutionitems', 'vitamins', 'heldItems', 'items', 'underground', 'keyItems']) {
        for (const resource of debugCatalog(kind)) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn btn-primary col-2 item-bag-item';
            button.dataset.debugKind = kind;
            button.dataset.debugKey = resource.key;
            if (resource.image) {
                const image = document.createElement('img');
                image.src = resource.image;
                image.height = 25;
                image.alt = '';
                button.append(image);
            }
            const label = document.createElement('div');
            label.textContent = resource.name;
            button.append(label);
            modalBody.querySelector(`#${kind}`).append(button);
        }
    }

    refreshDebugRegions();

    // Closures survive both the Desktop wrapper and Tampermonkey's isolated scope.
    eventMod.addEventListener('click', event => {
        const button = event.target.closest('[data-debug-kind], [data-debug-action]');
        if (!button || !eventMod.contains(button)) return;
        if (button.dataset.debugKind) {
            const pane = button.closest('.tab-pane');
            debugApply(button.dataset.debugKind, button.dataset.debugKey,
                pane.querySelector('input[type="number"]')?.value,
                pane.querySelector('[data-debug-operation]')?.value || 'add');
            return;
        }
        const actions = { loadPkdx, loadQuestLines, gainPk, gainPkrs };
        actions[button.dataset.debugAction]?.(Number(button.dataset.debugId));
    });
    const filter = event => {
        if (event.target.dataset.debugFilter === 'pokedex') filterPkdx();
        if (event.target.dataset.debugFilter === 'quests') filterQuestLine();
    };
    eventMod.addEventListener('input', filter);
    eventMod.addEventListener('change', filter);
}

function loadEpheniaScript(scriptName, initFunction, priorityFunction) {
    function reportScriptError(scriptName, error) {
        console.error(`Error while initializing '${scriptName}' userscript:\n${error}`);
        Notifier.notify({
            type: NotificationConstants.NotificationOption.warning,
            title: scriptName,
            message: `The '${scriptName}' userscript crashed while loading. Check for updates or disable the script, then restart the game.\n\nReport script issues to the script developer, not to the Pokéclicker team.`,
            timeout: GameConstants.DAY,
        });
    }
    const windowObject = !App.isUsingClient ? unsafeWindow : window;
    // Inject handlers if they don't exist yet
    if (windowObject.epheniaScriptInitializers === undefined) {
        windowObject.epheniaScriptInitializers = {};
        const oldInit = Preload.hideSplashScreen;
        var hasInitialized = false;

        // Initializes scripts once enough of the game has loaded
        Preload.hideSplashScreen = function (...args) {
            var result = oldInit.apply(this, args);
            if (App.game && !hasInitialized) {
                // Initialize all attached userscripts
                Object.entries(windowObject.epheniaScriptInitializers).forEach(([scriptName, initFunction]) => {
                    try {
                        initFunction();
                    } catch (e) {
                        reportScriptError(scriptName, e);
                    }
                });
                hasInitialized = true;
            }
            return result;
        }
    }

    // Prevent issues with duplicate script names
    if (windowObject.epheniaScriptInitializers[scriptName] !== undefined) {
        console.warn(`Duplicate '${scriptName}' userscripts found!`);
        Notifier.notify({
            type: NotificationConstants.NotificationOption.warning,
            title: scriptName,
            message: `Duplicate '${scriptName}' userscripts detected. This could cause unpredictable behavior and is not recommended.`,
            timeout: GameConstants.DAY,
        });
        let number = 2;
        while (windowObject.epheniaScriptInitializers[`${scriptName} ${number}`] !== undefined) {
            number++;
        }
        scriptName = `${scriptName} ${number}`;
    }
    // Add initializer for this particular script
    windowObject.epheniaScriptInitializers[scriptName] = initFunction;
    // Run any functions that need to execute before the game starts
    if (priorityFunction) {
        $(document).ready(() => {
            try {
                priorityFunction();
            } catch (e) {
                reportScriptError(scriptName, e);
                // Remove main initialization function  
                windowObject.epheniaScriptInitializers[scriptName] = () => null;
            }
        });
    }
}

if (!App.isUsingClient || localStorage.getItem('debugcheatstools') === 'true') {
    loadEpheniaScript('debugcheatstools', initSaveEditor);
}
