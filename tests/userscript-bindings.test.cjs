const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function wrappedScript(t, file, html, desktop, globals = {}) {
    const dom = new JSDOM(html, { url: 'https://www.pokeclicker.com/', runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    const w = dom.window, ready = [];
    const observable = initial => {
        let value = initial;
        return (...args) => args.length ? (value = args[0]) : value;
    };
    Object.assign(w, {
        App: { isUsingClient: desktop, game: {} },
        DesktopScriptHandler: { isEpheniaScriptEnabled: () => true },
        Preload: { hideSplashScreen() {} },
        ko: { observable, computed: config => config.read },
        $: () => ({ ready: callback => ready.push(callback) }),
        console: { error() {}, warn() {}, log() {} },
        ...globals,
    });
    w.unsafeWindow = w;
    // Match the desktop loader: declarations must remain private to this function.
    w.eval(`(function(){\n${fs.readFileSync(path.join(__dirname, '..', file), 'utf8')}\n})();`);
    for (const callback of ready) callback();
    return w;
}

for (const desktop of [true, false]) {
    const mode = desktop ? 'desktop' : 'browser';
    test(`${mode}: visual settings DOM bindings resolve their controller outside the script wrapper`, t => {
        const w = wrappedScript(t, 'additionalvisualsettings.user.js', `
            <div id="routeBattleContainer">
                <div class="pageItemTitle"><div><knockout></knockout></div></div>
                <div><knockout data-bind="template: pokemonSpriteTemplate"></knockout></div>
                <div class="catchChance"></div><div class="progress hitpoints"></div>
                <div class="pageItemFooter"><knockout data-bind="template: pokemonAttackTemplate"></knockout></div>
            </div>
            <div id="pokemonVitaminExpandedModal"><table><tbody data-bind="foreach: PartyController.getVitaminSortedList"><tr><td></td></tr></tbody></table></div>`, desktop, {
            PartyPokemon: class PartyPokemon {},
        });
        const nodes = w.document.createTreeWalker(w.document.body, w.NodeFilter.SHOW_COMMENT);
        let comment;
        while (nodes.nextNode()) {
            if (nodes.currentNode.textContent.includes('.route.header()')) { comment = nodes.currentNode; break; }
        }
        assert.ok(comment, 'initialization must create the native Knockout comment binding');
        const expression = comment.textContent.replace(/^ko ifnot:\s*/, '');
        assert.equal(w.eval(expression), false);
        w.AdditionalVisualSettings.graphicsDisabledSettings.route.header(true);
        assert.equal(w.eval(expression), true);
        assert.equal(w.loadEpheniaScript, undefined, 'private registration helpers must remain isolated');
    });

    test(`${mode}: frontier DOM controls invoke their controller outside the script wrapper`, t => {
        const w = wrappedScript(t, 'autobattlefrontier.user.js', `
            <div id="battleFrontierInformation"><div class="card-header"></div>
            <a onclick="BattleFrontierRunner.start(false)"></a><a onclick="BattleFrontierRunner.battleQuit()"></a></div>`, desktop, {
            BattleFrontierRunner: { nextStage() {} },
            BattleFrontierBattle: { pokemonAttack() {} },
        });
        const toggle = w.document.getElementById('bf-attack-ceil-start');
        w.eval(toggle.getAttribute('onclick'));
        assert.equal(w.localStorage.getItem('battleFrontAttackCeil'), '1');
        assert.equal(toggle.textContent, 'Max Attacks: 1');
        const input = w.document.getElementById('battle-front-input');
        input.value = '125';
        w.eval(w.document.getElementById('battle-front-input-submit').getAttribute('onclick'));
        const expression = input.getAttribute('data-bind').replace(/^value:\s*/, '');
        assert.equal(w.eval(expression), '125');
        assert.equal(w.localStorage.getItem('battleFrontCeil'), '125');
        assert.equal(w.addGlobalStyle, undefined, 'private style helpers must remain isolated');
    });
}
