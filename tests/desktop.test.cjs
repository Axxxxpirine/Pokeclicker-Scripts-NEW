const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '../desktop/app_src/src');
test('published desktop archive includes license notices and current userscript sources', () => {
    const asar = require('@electron/asar');
    const repo = path.resolve(__dirname, '..');
    const archive = path.join(repo, 'desktop/app.asar');
    const read = name => asar.extractFile(archive, name).toString('utf8');
    assert.equal(read('LICENSE-GPL-3.0.txt'), fs.readFileSync(path.join(repo, 'LICENSE'), 'utf8'));
    assert.equal(read('NOTICES.md'), fs.readFileSync(path.join(repo, 'desktop/app_src/NOTICES.md'), 'utf8'));
    for (const directory of [repo, path.join(repo, 'custom')]) {
        for (const name of fs.readdirSync(directory).filter(name => name.endsWith('.user.js'))) {
            assert.equal(read(`bundled-scripts/${name}`), fs.readFileSync(path.join(directory, name), 'utf8'), name);
        }
    }
    assert.equal(read('src/desktopupdatechecker.js'), fs.readFileSync(path.join(repo, 'desktopupdatechecker.js'), 'utf8'));
    for (const name of fs.readdirSync(root).filter(name => name.endsWith('.js'))) {
        assert.equal(read(`src/${name}`), fs.readFileSync(path.join(root, name), 'utf8'), name);
    }
});
function renderer() {
    const dom = new JSDOM('<div id="settingsModal"><div><ul class="nav-tabs"></ul><div class="tab-content"></div></div></div>', {url:'https://example.test',runScripts:'outside-only'});
    dom.window.eval(fs.readFileSync(path.join(root,'scripthandler.js'),'utf8')+'\nwindow.Handler = DesktopScriptHandler;');
    return dom;
}
test('corrupt script toggle does not abort the settings panel or touch the save', () => {
    const dom=renderer(), w=dom.window;
    w.localStorage.setItem('save','preserved');
    w.localStorage.setItem('mine','undefined');
    assert.equal(w.Handler.isEpheniaScriptEnabled('mine'),false);
    assert.equal(w.localStorage.getItem('save'),'preserved');
    dom.window.close();
});
test('registering a script twice produces one setting and a literal filename', () => {
    const dom=renderer(), w=dom.window;
    w.Handler.registerEpheniaScript('mine');w.Handler.registerEpheniaScript('mine');
    assert.equal(w.document.querySelectorAll('#checkbox-mine').length,1);
    w.Handler.registerUserScript('<img src=x>');
    assert.equal(w.document.querySelectorAll('img').length,0);
    dom.window.close();
});
test('invalid update preferences recover without clearing a one-shot request prematurely', () => {
    const dom=renderer(), w=dom.window;
    w.localStorage.setItem('epheniaScriptAutoUpdates','garbage');
    w.localStorage.setItem('epheniaUpdateScriptsNextLaunch','true');
    assert.equal(w.Handler.shouldScriptsAutoUpdate(),true);
    assert.equal(w.localStorage.getItem('epheniaUpdateScriptsNextLaunch'),'true');
    dom.window.close();
});
const { EventEmitter } = require('node:events');
function cacheFixture(t) {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pokeclicker-l6-'));
    t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    fs.mkdirSync(path.join(dir,'scripts'));
    return {dir, scripts:path.join(dir,'scripts')};
}
const script = (version,body='') => `// ==UserScript==\n// @name Test\n// @version ${version}\n// ==/UserScript==\n${body}`;
function loader(){return require(path.join(root,'desktop-scripts.js'));}
test('failed updates retain cached scripts, checksums and save files',async t=>{
    const {dir,scripts}=cacheFixture(t);fs.writeFileSync(path.join(scripts,'mine.user.js'),script('3.0.0'));
    fs.writeFileSync(path.join(dir,'save'),'original');
    const result=await loader().updateScripts({dataDir:dir,fetchText:async()=>{throw Error('offline')},autoUpdate:true});
    assert.equal(result.offline,true);assert.equal(fs.readFileSync(path.join(scripts,'mine.user.js'),'utf8'),script('3.0.0'));
    assert.equal(fs.readFileSync(path.join(dir,'save'),'utf8'),'original');
});
test('disabled updates preserve manually installed scripts without a checksum',async t=>{
    const {dir,scripts}=cacheFixture(t);fs.writeFileSync(path.join(scripts,'mine.user.js'),script('3.0.0','// local edit'));
    const result=await loader().updateScripts({dataDir:dir,autoUpdate:false,fetchText:async url=>url.includes('api.github')?JSON.stringify(url.endsWith('/custom')?[]:[{name:'mine.user.js',download_url:'https://raw.githubusercontent.com/test/mine'}]):script('3.1.0')});
    assert.equal(fs.readFileSync(path.join(scripts,'mine.user.js'),'utf8'),script('3.0.0','// local edit'));
    assert.equal(result.available,1);
});
test('invalid downloads and downgrades preserve last known working cache',async t=>{
    const {dir,scripts}=cacheFixture(t);fs.writeFileSync(path.join(scripts,'mine.user.js'),script('3.0.0'));
    for(const body of ['<html>Error</html>',script('2.0.0'),script('4.0.0','const =')]) {
        await loader().updateScripts({dataDir:dir,autoUpdate:true,fetchText:async url=>url.includes('api.github')?JSON.stringify(url.endsWith('/custom')?[]:[{name:'mine.user.js',download_url:'https://raw.githubusercontent.com/test/mine'}]):body});
        assert.equal(fs.readFileSync(path.join(scripts,'mine.user.js'),'utf8'),script('3.0.0'));
    }
});
test('broken directory listing falls back without renaming cached scripts',async t=>{
    const {dir,scripts}=cacheFixture(t);fs.writeFileSync(path.join(scripts,'mine.user.js'),script('3.0.0'));
    const result=await loader().updateScripts({dataDir:dir,autoUpdate:true,fetchText:async()=>'{broken'});
    assert.ok(result.offline);assert.ok(fs.existsSync(path.join(scripts,'mine.user.js')));
});
function windowFixture(t) {
    const dom=renderer();t.after(()=>dom.window.close());
    const w=dom.window;w.eval('window.started = 0; window.App = {start(){window.started++}};');
    const win=new EventEmitter(),wc=new EventEmitter();win.webContents=wc;
    wc.isDestroyed=()=>false;wc.executeJavaScript=async code=>w.eval(code);
    // Load a fresh document without the handler installed by renderer().
    w.document.querySelector('#settings-scripts').remove();w.document.querySelector('.nav-tabs').innerHTML='';
    return {w,win,wc};
}
test('offline loader respects selections, isolates lexical names and releases App.start once',async t=>{
    const {dir,scripts}=cacheFixture(t),{w,win,wc}=windowFixture(t);
    for(const name of ['a','b','off'])fs.writeFileSync(path.join(scripts,name+'.user.js'),script('1.0.0',`const shared=1; window.${name}=(window.${name}||0)+1;`));
    w.localStorage.setItem('a','true');w.localStorage.setItem('b','true');w.localStorage.setItem('off','false');
    loader().attachScriptsWindow(win,{dataDir:dir,fetchText:async()=>{throw Error('offline')},version:'2.2.0',electronVersion:'21.3.1',packageVersion:'1.2.0'});
    wc.emit('dom-ready');await new Promise(r=>setImmediate(r));w.App.start();w.App.start();
    wc.emit('did-finish-load');wc.emit('did-finish-load');
    await new Promise((resolve,reject)=>{const end=Date.now()+1000;function check(){if(w.desktopScriptsStatus)resolve();else if(Date.now()>end)reject(Error('loader stalled'));else setTimeout(check,5)}check()});
    assert.equal(w.started,1);assert.equal(w.a,1);assert.equal(w.b,1);assert.equal(w.off,undefined);
    assert.equal(w.document.querySelectorAll('#checkbox-a').length,1);
});
test('a scripts path that is a file cannot leave the game waiting forever',async t=>{
    const {dir,scripts}=cacheFixture(t),{w,win,wc}=windowFixture(t);fs.rmdirSync(scripts);fs.writeFileSync(scripts,'blocked');
    loader().attachScriptsWindow(win,{dataDir:dir,fetchText:async()=>{throw Error('offline')},version:'2.2.0'});
    wc.emit('dom-ready');await new Promise(r=>setImmediate(r));w.App.start();wc.emit('did-finish-load');
    await new Promise(r=>setTimeout(r,50));assert.equal(w.started,1);
});
test('invalid window sizes fall back without erasing the saved download directory',()=>{
    const {normalizeSettings}=require(path.join(root,'desktop-settings.js'));
    for(const sizing of [null,{Width:'Infinity',Height:600,Maximized:true},{Width:800,Height:NaN}]) {
        const config=normalizeSettings({Sizing:sizing,Downloads:{Directory:'/tmp/exports'}});
        assert.equal(config.Sizing.Width,800);assert.equal(config.Sizing.Height,600);
        assert.equal(config.Downloads.Directory,'/tmp/exports');
    }
});
test('completed exports remember their directory while cancelled downloads do not', t=>{
    const {rememberDownloads}=require(path.join(root,'desktop-settings.js'));
    const session=new EventEmitter(),config={Downloads:{Directory:'/tmp'}};let saves=0;
    rememberDownloads(session,config,()=>saves++);
    rememberDownloads(session,config,()=>saves++);
    const download=new EventEmitter();let options;
    download.getFilename=()=> '../../save.txt';download.setSaveDialogOptions=value=>options=value;download.getSavePath=()=>'/tmp/chosen/save.txt';
    session.emit('will-download',{},download);
    assert.equal(options.defaultPath,'/tmp/save.txt');
    download.emit('done',{},'cancelled');assert.equal(saves,0);
    const next=new EventEmitter();Object.assign(next,{getFilename:download.getFilename,setSaveDialogOptions:download.setSaveDialogOptions,getSavePath:download.getSavePath});
    session.emit('will-download',{},next);next.emit('done',{},'completed');
    assert.equal(config.Downloads.Directory,'/tmp/chosen');assert.equal(saves,1);
});
test('packaged scripts bootstrap offline and never replace an opted-out local script',async t=>{
    const {dir,scripts}=cacheFixture(t),bundle=path.join(dir,'bundle');fs.mkdirSync(bundle);
    fs.writeFileSync(path.join(bundle,'mine.user.js'),script('3.0.0'));
    fs.writeFileSync(path.join(bundle,'farm.user.js'),script('3.0.0'));
    fs.writeFileSync(path.join(scripts,'farm.user.js'),script('1.0.0','// personal'));
    await loader().updateScripts({dataDir:dir,bundledDir:bundle,autoUpdate:false,fetchText:async()=>{throw Error('offline')}});
    assert.equal(fs.readFileSync(path.join(scripts,'mine.user.js'),'utf8'),script('3.0.0'));
    assert.equal(fs.readFileSync(path.join(scripts,'farm.user.js'),'utf8'),script('1.0.0','// personal'));
});
test('a failed script does not prevent later scripts or the game from starting',async t=>{
    const {dir,scripts}=cacheFixture(t),{w,win,wc}=windowFixture(t);
    fs.writeFileSync(path.join(scripts,'a.user.js'),script('1.0.0','throw Error("test crash")'));
    fs.writeFileSync(path.join(scripts,'b.user.js'),script('1.0.0','window.loaded=true'));
    for(const name of ['a','b'])w.localStorage.setItem(name,'true');
    loader().attachScriptsWindow(win,{dataDir:dir,fetchText:async()=>{throw Error('offline')},version:'2.2.0'});
    wc.emit('dom-ready');await new Promise(r=>setImmediate(r));w.App.start();wc.emit('did-finish-load');
    await new Promise(r=>setTimeout(r,50));assert.equal(w.started,1);assert.equal(w.loaded,true);assert.equal(w.desktopScriptsStatus.errors[0],'a.user.js');
});
test('navigation during downloads cannot execute stale scripts in the next document',async t=>{
    const {dir,scripts}=cacheFixture(t),{w,win,wc}=windowFixture(t);
    fs.writeFileSync(path.join(scripts,'a.user.js'),script('1.0.0','window.ran=true'));
    w.localStorage.setItem('a','true');let release;const pending=new Promise(resolve=>release=resolve);
    loader().attachScriptsWindow(win,{dataDir:dir,fetchText:async()=>{await pending;throw Error('offline')},version:'2.2.0'});
    wc.emit('dom-ready');await new Promise(r=>setImmediate(r));w.App.start();wc.emit('did-finish-load');
    await new Promise(r=>setImmediate(r));wc.emit('did-start-navigation',{},'file:///new',false,true);release();
    await new Promise(r=>setTimeout(r,30));assert.equal(w.ran,undefined);assert.equal(w.started,0);
});
test('desktop update metadata reports a newer mod without executing the downloaded checker',async t=>{
    const {dir}=cacheFixture(t);
    const result=await loader().updateScripts({dataDir:dir,autoUpdate:false,fetchText:async url=>url.includes('api.github')?JSON.stringify(url.endsWith('/custom')?[]:[{name:'desktopupdatechecker.js',download_url:'https://raw.githubusercontent.com/test/checker'}]):"const LATEST_VERSION = '2.10.0'; throw Error('must not execute');"});
    assert.equal(result.latestDesktopVersion,'2.10.0');
});
test('custom filenames keep legacy disabled preferences and cannot collide with downloaded toggles',()=>{
    const dom=renderer(),w=dom.window;
    w.localStorage.setItem('foo','false');
    w.Handler.registerEpheniaScript('foo');w.Handler.registerUserScript('foo.bar.js');
    assert.equal(w.Handler.isUserScriptEnabled('foo.bar.js'),false);
    assert.equal(w.document.querySelectorAll('#settings-scripts-enableScriptsUser input').length,1);
    dom.window.close();
});
test('requesting an update during a check is retained for the next launch',async t=>{
    const {dir}=cacheFixture(t),{w,win,wc}=windowFixture(t);
    w.localStorage.setItem('epheniaScriptAutoUpdates','false');
    let release;const pending=new Promise(resolve=>release=resolve);
    loader().attachScriptsWindow(win,{dataDir:dir,fetchText:async()=>{await pending;return '[]'},version:'2.2.0'});
    wc.emit('dom-ready');await new Promise(r=>setImmediate(r));wc.emit('did-finish-load');
    await new Promise(r=>setImmediate(r));w.localStorage.setItem('epheniaUpdateScriptsNextLaunch','true');release();
    await new Promise(r=>setTimeout(r,30));assert.equal(w.localStorage.getItem('epheniaUpdateScriptsNextLaunch'),'true');
});
test('online recovery updates the cache and the next offline launch retains it and the save',async t=>{
    const {dir,scripts}=cacheFixture(t);fs.writeFileSync(path.join(dir,'save'),'unchanged');
    fs.writeFileSync(path.join(scripts,'mine.user.js'),script('1.0.0'));
    const online=await loader().updateScripts({dataDir:dir,autoUpdate:true,fetchText:async url=>url.includes('api.github')?JSON.stringify(url.endsWith('/custom')?[]:[{name:'mine.user.js',download_url:'https://raw.githubusercontent.com/test/mine'}]):script('2.0.0')});
    assert.equal(online.updated,1);assert.equal(online.failed,0);
    assert.equal(fs.readFileSync(path.join(scripts,'mine.user.js'),'utf8'),script('2.0.0'));
    const offline=await loader().updateScripts({dataDir:dir,autoUpdate:true,fetchText:async()=>{throw Error('offline')}});
    assert.equal(offline.offline,true);assert.equal(fs.readFileSync(path.join(scripts,'mine.user.js'),'utf8'),script('2.0.0'));
    assert.equal(fs.readFileSync(path.join(dir,'save'),'utf8'),'unchanged');
    assert.deepEqual(fs.readdirSync(scripts).filter(f=>f.endsWith('.tmp')),[]);
});
test('simultaneous windows share the same cache update instead of queuing repeat downloads',async t=>{
    const {dir}=cacheFixture(t);let requests=0,release;const barrier=new Promise(resolve=>release=resolve);
    const options={dataDir:dir,autoUpdate:false,fetchText:async()=>{requests++;await barrier;return '[]'}};
    const first=loader().updateScripts(options),second=loader().updateScripts(options);
    release();await Promise.all([first,second]);assert.equal(requests,2);
});
