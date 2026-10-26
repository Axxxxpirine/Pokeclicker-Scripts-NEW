const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {JSDOM} = require('jsdom');
const source = path.resolve(__dirname, '../desktop/app_src/src');
const {updateScripts, fetchText} = require(path.join(source, 'desktop-scripts'));
const body = '// ==UserScript==\n// @version 2.0.0\n// ==/UserScript==\nwindow.updated = true;';
const raw = 'https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/';
function entry(name = 'mine.user.js', folder = '', content = body) {
    return {name, path:folder + name, type:'file', sha:createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex'), download_url:raw + folder + name};
}
function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'script-security-'));
    t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
    fs.mkdirSync(path.join(directory, 'scripts'));
    return directory;
}
function download(entries, content = body, custom = []) {
    return async url => url.includes('api.github.com') ? JSON.stringify(url.endsWith('/custom') ? custom : entries) : content;
}
function renderer(t) {
    const dom = new JSDOM('<div id="settingsModal"><div><ul class="nav-tabs"></ul><div class="tab-content"></div></div></div>', {url:'https://example.test', runScripts:'outside-only'});
    t.after(() => dom.window.close());
    dom.window.eval(fs.readFileSync(path.join(source, 'scripthandler.js'), 'utf8') + '\nwindow.Handler = DesktopScriptHandler;');
    return dom.window;
}
test('script registration and toggle changes never replace save, player or settings data', t => {
    const w = renderer(t);
    for (const name of ['save', 'player', 'settings']) {
        const saved = JSON.stringify({name, value:42});
        w.localStorage.setItem(name, saved);
        w.Handler.registerUserScript(name + '.js');
        w.Handler.registerEpheniaScript(name);
        for (const id of ['checkbox-desktopUserScript:' + name + '.js', 'checkbox-' + name]) {
            const input = w.document.getElementById(id);
            input.checked = true;
            input.dispatchEvent(new w.Event('change'));
        }
        assert.equal(w.localStorage.getItem(name), saved);
        assert.equal(w.Handler.isEpheniaScriptEnabled(name), true);
    }
});
test('legacy disabled consent migrates to independent namespaces without modifying legacy keys', t => {
    const w = renderer(t);
    w.localStorage.setItem('mine', 'false');
    assert.equal(w.Handler.isEpheniaScriptEnabled('mine'), false);
    assert.equal(w.Handler.isUserScriptEnabled('mine.js'), false);
    assert.equal(w.localStorage.getItem('desktopEpheniaScript:mine'), 'false');
    w.localStorage.setItem('desktopEpheniaScript:mine', 'true');
    assert.equal(w.Handler.isEpheniaScriptEnabled('mine'), true);
    assert.equal(w.Handler.isUserScriptEnabled('mine.js'), false);
    assert.equal(w.localStorage.getItem('mine'), 'false');
});
test('matching Git blob content from the fork root and custom directory installs', async t => {
    const dataDir = fixture(t);
    const result = await updateScripts({dataDir, autoUpdate:true, fetchText:download([entry()], body, [entry('extra.user.js', 'custom/')])});
    assert.equal(result.updated, 2);
    assert.equal(fs.readFileSync(path.join(dataDir, 'scripts/extra.user.js'), 'utf8'), body);
});
test('foreign sources, wrong paths, symlink entries and Windows aliases cannot install scripts', async t => {
    for (const invalid of [
        {...entry(), download_url:'https://raw.githubusercontent.com/attacker/repo/master/mine.user.js'},
        {...entry(), path:'custom/mine.user.js'},
        {...entry(), type:'symlink'},
        entry('../mine.user.js'), entry('CON.user.js'), entry('mine:payload.user.js'),
        {...entry(), sha:undefined}, {...entry(), sha:'not-a-git-sha'},
    ]) {
        const dataDir = fixture(t);
        const result = await updateScripts({dataDir, autoUpdate:true, fetchText:download([invalid])});
        assert.equal(result.offline, true, JSON.stringify(invalid));
        assert.deepEqual(fs.readdirSync(path.join(dataDir, 'scripts')), []);
    }
});
test('a valid but mismatched download cannot overwrite the trusted cache', async t => {
    const dataDir = fixture(t), file = path.join(dataDir, 'scripts/mine.user.js');
    fs.writeFileSync(file, '// ==UserScript==\n// @version 1.0.0\n// trusted');
    const before = fs.readFileSync(file, 'utf8');
    const result = await updateScripts({dataDir, autoUpdate:true, fetchText:download([entry()], body + '\nwindow.injected = true;')});
    assert.equal(result.failed, 1);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
});
test('case-insensitive cache filename collisions are refused before downloading', async t => {
    const dataDir = fixture(t);
    const result = await updateScripts({dataDir, autoUpdate:true, fetchText:download([entry('mine.user.js'), entry('MINE.user.js')])});
    assert.equal(result.offline, true);
    assert.deepEqual(fs.readdirSync(path.join(dataDir, 'scripts')), []);
});
test('a symlinked scripts directory cannot redirect updater writes', async t => {
    const dataDir = fixture(t), outside = path.join(dataDir, 'outside');
    fs.mkdirSync(outside);
    fs.rmdirSync(path.join(dataDir, 'scripts'));
    fs.symlinkSync(outside, path.join(dataDir, 'scripts'), 'junction');
    await assert.rejects(updateScripts({dataDir, autoUpdate:true, fetchText:download([entry()])}), /directory|symlink/i);
    assert.deepEqual(fs.readdirSync(outside), []);
});
test('a symlinked cached script is not read or replaced by updates', async t => {
    const dataDir = fixture(t), outside = path.join(dataDir, 'outside.js'), target = path.join(dataDir, 'scripts/mine.user.js');
    fs.writeFileSync(outside, '// private');
    fs.symlinkSync(outside, target);
    const result = await updateScripts({dataDir, autoUpdate:true, fetchText:download([entry()])});
    assert.equal(result.failed, 1);
    assert.equal(fs.lstatSync(target).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(outside, 'utf8'), '// private');
});
test('a synchronously rejected HTTPS URL leaves no crashing timeout behind', async () => {
    await assert.rejects(fetchText('http://example.test', 10));
    await new Promise(resolve => setTimeout(resolve, 25));
});
test('script downloads reject oversized UTF-8 byte streams before installing them', async t => {
    const https = require('node:https');
    const {PassThrough} = require('node:stream');
    const {EventEmitter} = require('node:events');
    t.mock.method(https, 'get', (_url, _options, receive) => {
        const request = new EventEmitter();
        const response = new PassThrough();
        response.statusCode = 200;
        request.destroy = error => { response.destroy(); if (error) process.nextTick(() => request.emit('error', error)); };
        process.nextTick(() => {
            receive(response);
            response.end('é'.repeat(3 * 1024 * 1024));
        });
        return request;
    });
    await assert.rejects(fetchText(raw + 'mine.user.js'), /too large/);
});
test('a failed HTTP response is destroyed instead of consuming an unbounded error stream', async t => {
    const https = require('node:https');
    const {PassThrough} = require('node:stream');
    const {EventEmitter} = require('node:events');
    const response = new PassThrough();
    response.statusCode = 503;
    t.mock.method(https, 'get', (_url, _options, receive) => {
        const request = new EventEmitter();
        request.destroy = error => process.nextTick(() => request.emit('error', error));
        process.nextTick(() => receive(response));
        return request;
    });
    await assert.rejects(fetchText(raw + 'mine.user.js'), /HTTP 503/);
    assert.equal(response.destroyed, true);
});
test('custom script directory and file symlinks cannot execute outside scripts or block game start', async t => {
    const {EventEmitter} = require('node:events');
    const {attachScriptsWindow} = require(path.join(source, 'desktop-scripts'));
    for (const directoryLink of [true, false]) {
        const dataDir = fixture(t), outside = path.join(dataDir, 'outside');
        fs.mkdirSync(outside);
        fs.writeFileSync(path.join(outside, 'escape.js'), 'window.escaped = true;');
        const custom = path.join(dataDir, 'custom-scripts');
        if (directoryLink) fs.symlinkSync(outside, custom, 'junction');
        else {
            fs.mkdirSync(custom);
            fs.symlinkSync(path.join(outside, 'escape.js'), path.join(custom, 'escape.js'));
        }
        const w = renderer(t);
        w.document.querySelector('#settings-scripts').remove();
        w.document.querySelector('.nav-tabs').innerHTML = '';
        w.eval('window.App = {start(){window.gameStarted = true;}};');
        const contents = new EventEmitter();
        contents.isDestroyed = () => false;
        contents.executeJavaScript = async code => w.eval(code);
        attachScriptsWindow({webContents:contents}, {dataDir, fetchText:async () => {throw Error('offline');}, version:'2.2.2'});
        contents.emit('dom-ready');
        await new Promise(resolve => setImmediate(resolve));
        w.App.start();
        contents.emit('did-finish-load');
        const deadline = Date.now() + 1000;
        while (!w.desktopScriptsStatus && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(w.gameStarted, true);
        assert.equal(w.escaped, undefined);
    }
});
const repositoryRoot = path.resolve(__dirname, '..');
const guardedScripts = ['', 'custom/'].flatMap(folder => fs.readdirSync(path.join(repositoryRoot, folder))
    .filter(name => name.endsWith('.user.js') && name !== 'scriptfixerupper.user.js')
    .map(name => folder + name));
for (const filename of guardedScripts) {
    test(`${filename} startup honors namespaced consent over the legacy toggle`, t => {
        const name = path.basename(filename).split('.')[0];
        for (const enabled of [true, false]) {
            const w = renderer(t), ready = [];
            w.DesktopScriptHandler = w.Handler;
            w.App = {isUsingClient:true, game:{}};
            w.Preload = {hideSplashScreen(){}};
            const observable = initial => { let value = initial; return (...args) => args.length ? (value = args[0]) : value; };
            w.ko = {observable, computed:() => () => false, pureComputed:() => () => false};
            w.baseLootTierChance = {common:1};
            w.pokemonList = [];
            w.$ = () => ({ready:callback => ready.push(callback)});
            w.localStorage.setItem(name, String(!enabled));
            w.localStorage.setItem('desktopEpheniaScript:' + name, String(enabled));
            w.eval(fs.readFileSync(path.join(repositoryRoot, filename), 'utf8'));
            const registered = typeof w.epheniaScriptInitializers?.[name] === 'function' || ready.length > 0;
            assert.equal(registered, enabled, 'actual userscript must register only when its current desktop setting is enabled');
            assert.equal(w.localStorage.getItem(name), String(!enabled), 'startup must not synchronize or overwrite the legacy key');
            if (name === 'optionalaccelerators') {
                w.Preload.hideSplashScreen();
                assert.equal(typeof w.OptionalAccelerators?.getState, enabled ? 'function' : 'undefined');
            }
        }
    });
}
