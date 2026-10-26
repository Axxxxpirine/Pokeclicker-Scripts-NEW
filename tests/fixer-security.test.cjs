const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

function setup(values, accepted = true, desktop = true, direct = true) {
    const dom = new JSDOM('', { url: 'https://www.pokeclicker.com/' });
    const storage = dom.window.localStorage;
    for (const [key, value] of Object.entries(values)) storage.setItem(key, value);
    const timers = [];
    let reloads = 0;
    let resumed = 0;
    const context = vm.createContext({
        localStorage: storage, App: { isUsingClient: desktop }, console,
        confirm: () => accepted, alert() {}, Preload: { load() {} },
        setTimeout: callback => timers.push(callback), location: { reload: () => reloads++ },
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'scriptfixerupper.user.js'), 'utf8'), context);
    if (direct) {
        // Exercise the reset directly, without starting the game's loading lifecycle.
        timers.length = 0;
        context.resume = () => resumed++;
        vm.runInContext('initFixerUpper(resume)', context);
    }
    for (const timer of timers) timer();
    return { storage, dom, reloads, resumed };
}

test('script reset preserves execution and update choices, including disabled user scripts', t => {
    const choices = {
        'desktopUserScript:custom.user.js': 'false',
        'desktopUserScript:enabled.user.js': 'true',
        'desktopEpheniaScript:enhancedautoclicker': 'true',
        'desktopEpheniaScript:optionalresources': 'false',
        enhancedautoclicker: 'true', custom: 'false',
        epheniaScriptAutoUpdates: 'false', epheniaUpdateScriptsNextLaunch: 'false',
    };
    const h = setup(choices);
    t.after(() => h.dom.window.close());
    for (const [key, value] of Object.entries(choices)) assert.equal(h.storage.getItem(key), value, key);
    assert.equal(h.reloads, 1);
});

test('script reset removes known preferences and preserves unknown game data and backups', t => {
    const preserved = {
        save0: 'SAVE', player0: 'PLAYER', settings0: 'SETTINGS',
        achievements: 'GAME DATA', autoSaveRecovery: 'RECOVERY',
        autoFarmFutureGameFeature: 'GAME DATA', unknownPlugin: 'OTHER PLUGIN',
        'catchfilterfantasia.backup.catchFilter': 'ORIGINAL PREFERENCES',
    };
    const reset = {
        autoPlantState: 'true', autoFarmMutationPlan: 'broken', autoHatchQueueLimit: 'bad',
        autoClickMultiplier: 'bad', filterBallPref: 'bad', AVSgraphicsDisabledSettings: 'bad',
        autoQuestRefreshBudget: 'bad', omegaProteinCap: 'bad', shinySetRates: 'bad',
        'Ephenia\'s Gift': 'true',
    };
    const h = setup({ ...preserved, ...reset });
    t.after(() => h.dom.window.close());
    for (const [key, value] of Object.entries(preserved)) assert.equal(h.storage.getItem(key), value, key);
    for (const key of Object.keys(reset)) assert.equal(h.storage.getItem(key), null, key);
});

test('confirmed desktop reset disables only the fixer itself for the next launch', t => {
    const h = setup({ scriptfixerupper: 'true', 'desktopEpheniaScript:scriptfixerupper': 'true' });
    t.after(() => h.dom.window.close());
    assert.equal(h.storage.getItem('scriptfixerupper'), 'false');
    assert.equal(h.storage.getItem('desktopEpheniaScript:scriptfixerupper'), 'false');
    assert.equal(h.reloads, 1);
});

test('cancelled reset preserves storage and resumes loading without reloading', t => {
    const h = setup({ autoPlantState: 'true', 'desktopUserScript:custom.js': 'false' }, false);
    t.after(() => h.dom.window.close());
    assert.equal(h.storage.getItem('autoPlantState'), 'true');
    assert.equal(h.storage.getItem('desktopUserScript:custom.js'), 'false');
    assert.equal(h.storage.length, 2);
    assert.equal(h.reloads, 0);
    assert.equal(h.resumed, 1);
});

test('browser reset retains its completion notice without changing desktop consent', t => {
    const h = setup({ 'desktopEpheniaScript:scriptfixerupper': 'true', autoMineState: 'true' }, true, false);
    t.after(() => h.dom.window.close());
    assert.equal(h.storage.getItem('scriptfixerupper_browsernotification'), 'true');
    assert.equal(h.storage.getItem('desktopEpheniaScript:scriptfixerupper'), 'true');
    assert.equal(h.storage.getItem('autoMineState'), null);
});

for (const [name, current, legacy, runs] of [
    ['new enabled consent overrides legacy OFF', 'true', 'false', true],
    ['new disabled consent overrides legacy ON', 'false', 'true', false],
    ['missing namespaced consent falls back to legacy ON', null, 'true', true],
    ['malformed namespaced consent falls back to legacy ON', 'broken', 'true', true],
    ['nonboolean namespaced consent does not enable the fixer', '"true"', 'false', false],
]) {
    test(`fixer startup: ${name}`, t => {
        const values = { scriptfixerupper: legacy, autoMineState: 'true' };
        if (current !== null) values['desktopEpheniaScript:scriptfixerupper'] = current;
        const h = setup(values, true, true, false);
        t.after(() => h.dom.window.close());
        assert.equal(h.reloads, runs ? 1 : 0);
        assert.equal(h.storage.getItem('autoMineState'), runs ? null : 'true');
        if (!runs) {
            assert.equal(h.storage.getItem('scriptfixerupper'), legacy);
            assert.equal(h.storage.getItem('desktopEpheniaScript:scriptfixerupper'), current);
        }
    });
}
