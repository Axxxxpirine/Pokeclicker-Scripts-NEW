const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {EventEmitter} = require('node:events');
const security = require('../desktop/app_src/src/desktop-security');

function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-security-'));
    t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
    const root = path.join(dir, 'game');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><html><head><title>Game</title></head><body>ok</body></html>');
    return {dir, root, index:path.join(root, 'index.html')};
}
test('Discord activity accepts only bounded strings and finite timestamps from renderer data', () => {
    assert.equal(security.discordActivity(null), null);
    assert.equal(security.discordActivity({enabled:'true'}), null);
    const activity = security.discordActivity({enabled:true,line1:{length:300},line2:'x'.repeat(500),startTimestamp:Infinity,largeImageKey:'https://example.invalid/leak',smallImageKey:'pokeball',smallImageText:'ok'});
    assert.equal(activity.details,'--');
    assert.equal(activity.state.length,128);
    assert.equal(activity.startTimestamp,undefined);
    assert.equal(activity.largeImageKey,undefined);
    assert.equal(activity.smallImageKey,'pokeball');
});
test('renderer isolation is explicit and obsolete Electron runtimes are rejected', () => {
    assert.equal(security.isSupportedRuntime('21.3.1'), false);
    assert.equal(security.isSupportedRuntime('45.0.0-beta.1'), false);
    assert.equal(security.isSupportedRuntime('45.0.0'), true);
    assert.equal(security.isSupportedRuntime('45.0.1'), true);
    for (const key of ['nodeIntegration','nodeIntegrationInWorker','nodeIntegrationInSubFrames','webviewTag','allowRunningInsecureContent']) assert.equal(security.WEB_PREFERENCES[key], false, key);
    for (const key of ['contextIsolation','sandbox','webSecurity']) assert.equal(security.WEB_PREFERENCES[key], true, key);
});
test('local resources cannot escape approved game roots or follow symlinks', t => {
    const {dir,root,index} = fixture(t);
    const outside = path.join(dir, 'private.txt');
    fs.writeFileSync(outside, 'private');
    fs.symlinkSync(outside, path.join(root, 'leak.txt'));
    assert.equal(security.isAllowedLocalURL(pathToFileURL(index).href, [root]), true);
    for (const value of [pathToFileURL(outside).href,pathToFileURL(path.join(root,'leak.txt')).href,'file://remote-server/share/private','https://example.com','file:///invalid/%2Fsecret']) assert.equal(security.isAllowedLocalURL(value,[root]),false,value);
});
test('CSP is inserted before game scripts, is idempotent and never patches a symlink', t => {
    const {dir,index,root} = fixture(t);
    security.protectGameIndex(index, root);
    const html = fs.readFileSync(index, 'utf8');
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /object-src 'none'/);
    assert.match(html, /form-action 'none'/);
    security.protectGameIndex(index, root);
    assert.equal(fs.readFileSync(index,'utf8'),html);
    const other = path.join(dir,'outside.html');
    fs.writeFileSync(other,'<head></head>');
    fs.symlinkSync(other,path.join(root,'link.html'));
    assert.throws(() => security.protectGameIndex(path.join(root,'link.html'), root));
    assert.equal(fs.readFileSync(other,'utf8'),'<head></head>');
});
test('CSP patch rejects symlinked parent directories without changing outside HTML', t => {
    for (const linkName of ['pokeclicker-master', 'docs']) {
        const {dir, root, index} = fixture(t);
        const dataDir = path.join(dir, 'data');
        fs.mkdirSync(dataDir);
        let linkedIndex;
        if (linkName === 'pokeclicker-master') {
            fs.mkdirSync(path.join(root, 'docs'));
            fs.renameSync(index, path.join(root, 'docs/index.html'));
            fs.symlinkSync(root, path.join(dataDir, linkName), 'junction');
            linkedIndex = path.join(dataDir, 'pokeclicker-master/docs/index.html');
        } else {
            fs.mkdirSync(path.join(dataDir, 'pokeclicker-master'));
            fs.symlinkSync(root, path.join(dataDir, 'pokeclicker-master/docs'), 'junction');
            linkedIndex = path.join(dataDir, 'pokeclicker-master/docs/index.html');
        }
        const before = fs.readFileSync(linkedIndex, 'utf8');
        assert.throws(() => security.protectGameIndex(linkedIndex, dataDir), /symbolic|symlink/i);
        assert.equal(fs.readFileSync(linkedIndex, 'utf8'), before);
    }
});
test('CSP patch requires an explicit trusted root and rejects files outside it', t => {
    const {dir, root, index} = fixture(t);
    const outside = path.join(dir, 'outside.html');
    fs.writeFileSync(outside, '<head></head>');
    assert.throws(() => security.protectGameIndex(index), /root/i);
    assert.throws(() => security.protectGameIndex(outside, root), /root/i);
    assert.equal(fs.readFileSync(outside, 'utf8'), '<head></head>');
});
test('setup exposes progress updates to the main process and renders them as text', t => {
    const {JSDOM} = require('jsdom');
    const html = fs.readFileSync(path.join(__dirname, '../desktop/app_src/src/pokeclicker-master/docs/index.html'), 'utf8');
    const dom = new JSDOM(html, {runScripts:'dangerously'});
    t.after(() => dom.window.close());
    assert.equal(typeof dom.window.setStatus, 'function');
    dom.window.setStatus('Validating <b>game files</b>...');
    assert.equal(dom.window.document.getElementById('status').textContent, 'Validating <b>game files</b>...');
    assert.equal(dom.window.document.querySelector('#status b'), null);
});
test('window navigation denies popups, webviews, foreign files and non-HTTPS handlers', async t => {
    const {root,index} = fixture(t);
    const contents = new EventEmitter();
    const opened = [];
    contents.setWindowOpenHandler = fn => { contents.openHandler = fn; };
    security.protectWindow({webContents:contents}, {indexFiles:[index],openExternal:url=>opened.push(url)});
    const event = () => ({prevented:false,preventDefault(){this.prevented=true;}});
    for (const url of ['javascript:alert(1)','file:///etc/passwd','https://example.com','https://github.com.evil.test/','https://user:pass@github.com/']) {
        assert.equal(contents.openHandler({url}).action,'deny');
        const e=event();contents.emit('will-navigate',e,url);assert.equal(e.prevented,true);
    }
    assert.equal(opened.length,0);
    assert.equal(contents.openHandler({url:'https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/issues'}).action,'deny');
    await Promise.resolve();
    assert.deepEqual(opened,['https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/issues']);
    const local=event();contents.emit('will-navigate',local,pathToFileURL(index).href+'#settings');assert.equal(local.prevented,false);
    const webview=event();contents.emit('will-attach-webview',webview,{},{});assert.equal(webview.prevented,true);
    assert.ok(root);
});
test('session denies permissions and requests for arbitrary local files', t => {
    const {root,index}=fixture(t);
    const session = {webRequest:{onBeforeRequest(filter,fn){this.request=fn;}}};
    session.setPermissionRequestHandler=fn=>{session.permission=fn;};
    session.setPermissionCheckHandler=fn=>{session.check=fn;};
    security.protectSession(session,[root]);
    let granted;
    session.permission({},'media',v=>{granted=v;});assert.equal(granted,false);
    assert.equal(session.check({},'geolocation','file://'),false);
    let decision;
    session.webRequest.request({url:'file:///etc/passwd'},value=>{decision=value;});assert.equal(decision.cancel,true);
    session.webRequest.request({url:pathToFileURL(index).href},value=>{decision=value;});assert.equal(decision.cancel,false);
});

test('CSP permits the game timer worker and translation data without allowing remote scripts', () => {
    const rules = Object.fromEntries(security.CSP.split(';').map(rule => rule.trim().split(/\s+/)).filter(parts => parts[0]).map(([name,...values]) => [name,values]));
    assert.deepEqual(rules['worker-src'], ['blob:']);
    assert.ok(rules['connect-src'].includes('https://translations.pokeclicker.com'));
    assert.deepEqual(rules['script-src'], ["'self'", "'unsafe-inline'", "'unsafe-eval'"]);
    assert.deepEqual(rules['frame-src'], ["'none'"]);
    assert.deepEqual(rules['object-src'], ["'none'"]);
});
