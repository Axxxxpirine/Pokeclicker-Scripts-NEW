'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const vm = require('vm');
const { randomUUID, createHash } = require('crypto');
const semver = require('semver');
const REPOSITORY = 'https://api.github.com/repos/Axxxxpirine/Pokeclicker-Scripts-NEW/contents/';
const updates = new Map();

// A wall-clock deadline also bounds DNS, stalled bodies and slow trickles.
function fetchText(url, timeout = 10000) {
    return new Promise((resolve, reject) => {
        let request;
        const timer = setTimeout(() => request.destroy(new Error('Download deadline exceeded')), timeout);
        const finish = (error, body) => {
            clearTimeout(timer);
            if (error) reject(error); else resolve(body);
        };
        request = https.get(url, {headers: {'User-Agent': 'Pokeclicker-Scripts-Desktop', Accept: 'application/vnd.github+json'}}, response => {
            if (response.statusCode !== 200) {
                response.resume();
                finish(new Error(`HTTP ${response.statusCode}`));
                return;
            }
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => {
                body += chunk;
                if (body.length > 4 * 1024 * 1024) request.destroy(new Error('Script response too large'));
            });
            response.on('end', () => finish(null, body));
            response.on('error', finish);
            response.on('aborted', () => finish(new Error('Incomplete response')));
        });
        request.on('error', finish);
    });
}
function atomicWrite(file, body) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporary, body, 'utf8');
        fs.renameSync(temporary, file);
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}
function scriptVersion(body) {
    return body.match(/^\/\/\s*@version\s+(\S+)/m)?.[1];
}
function validateScript(body) {
    if (!body.includes('==UserScript==')) throw new Error('Missing userscript metadata');
    new vm.Script(`(function(){\n${body}\n})();`);
}
function listScripts(directory) {
    return fs.readdirSync(directory, {withFileTypes:true})
        .filter(entry => entry.isFile() && entry.name.endsWith('.js') && entry.name !== 'desktopupdatechecker.js')
        .map(entry => entry.name).sort();
}
async function performUpdate({dataDir, bundledDir, autoUpdate, fetchText: request = fetchText}) {
    const directory = path.join(dataDir, 'scripts');
    fs.mkdirSync(directory, {recursive:true});
    const checksumFile = path.join(directory, 'fileVersions.json');
    let checksums = {};
    try {
        const parsed = JSON.parse(fs.readFileSync(checksumFile, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) checksums = parsed;
    } catch (_) { /* A missing checksum never authorizes replacing a local file. */ }
    const result = {offline:false, failed:0, available:0, updated:0};
    // The packaged, tested scripts also work on the first offline script launch.
    // Existing local modifications are preserved when updates are disabled.
    if (bundledDir && fs.existsSync(bundledDir)) {
        for (const name of listScripts(bundledDir)) {
            try {
                const file = path.join(directory, name);
                const body = fs.readFileSync(path.join(bundledDir, name), 'utf8');
                validateScript(body);
                const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
                const oldVersion = old && semver.valid(scriptVersion(old));
                const newVersion = semver.valid(scriptVersion(body));
                if (old === null || (autoUpdate && oldVersion && newVersion && semver.gt(newVersion, oldVersion))) {
                    atomicWrite(file, body);
                    checksums[name] = createHash('md5').update(body).digest('hex');
                    result.updated++;
                }
            } catch (error) { result.failed++; console.warn('Cannot seed packaged script:', error.message); }
        }
    }
    let files;
    try {
        const listings = await Promise.all([request(REPOSITORY), request(REPOSITORY+'custom')]);
        files = listings.flatMap(body => {
            const entries = JSON.parse(body);
            if (!Array.isArray(entries)) throw new Error('Invalid repository listing');
            return entries.filter(entry => (entry.name?.endsWith('.user.js') || entry.name === 'desktopupdatechecker.js')).map(entry => {
                if (path.basename(entry.name) !== entry.name || entry.name.includes('\\') || !/^https:\/\/raw\.githubusercontent\.com\//.test(entry.download_url)) {
                    throw new Error('Invalid script path or source');
                }
                return entry;
            });
        });
        if (new Set(files.map(file => file.name)).size !== files.length) throw new Error('Duplicate script names');
    } catch (_) {
        return {...result, offline:true};
    }
    // Four workers bound startup time without flooding GitHub.
    let next = 0;
    await Promise.all(Array.from({length:Math.min(4, files.length)}, async () => {
        while (next < files.length) {
            const entry = files[next++], file = path.join(directory, entry.name);
            try {
                const body = await request(entry.download_url);
                if (entry.name === 'desktopupdatechecker.js') {
                    const version = body.match(/const LATEST_VERSION = ['"]([^'"]+)['"]/);
                    if (semver.valid(version?.[1])) result.latestDesktopVersion = version[1];
                    continue;
                }
                validateScript(body);
                const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
                const oldVersion = old && semver.valid(scriptVersion(old));
                const newVersion = semver.valid(scriptVersion(body));
                if (oldVersion && (!newVersion || semver.lt(newVersion, oldVersion))) continue;
                if (old !== body && old !== null && !autoUpdate) { result.available++; continue; }
                if (old !== body) { atomicWrite(file, body); result.updated++; }
                checksums[entry.name] = createHash('md5').update(body).digest('hex');
            } catch (error) {
                result.failed++;
                console.warn(`Script update retained cache for ${entry.name}: ${error.message}`);
            }
        }
    }));
    try { atomicWrite(checksumFile, JSON.stringify(checksums)); }
    catch (error) { result.failed++; console.warn('Cannot save script checksums:', error.message); }
    return result;
}
// Windows share the cache. Serialize writes, including different update preferences.
function updateScripts(options) {
    const key = path.resolve(options.dataDir);
    const previous = updates.get(key);
    if (previous && previous.autoUpdate === options.autoUpdate) return previous.promise;
    const pending = (previous?.promise || Promise.resolve()).catch(() => {}).then(() => performUpdate(options));
    updates.set(key, {promise:pending, autoUpdate:options.autoUpdate});
    pending.finally(() => { if (updates.get(key)?.promise === pending) updates.delete(key); }).catch(() => {});
    return pending;
}

function attachScriptsWindow(gameWindow, options) {
    const contents = gameWindow.webContents;
    let generation = 0, ready = Promise.resolve(false), started = -1;
    const execute = source => contents.executeJavaScript(source);
    const report = error => console.warn('Desktop scripts:', error.message);
    contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
        if (mainFrame && !inPlace) { generation++; started = -1; }
    });
    contents.on('dom-ready', () => {
        const token = generation;
        ready = execute(`(() => {
            if (typeof App === 'undefined' || typeof App.start !== 'function') return false;
            if (window.desktopScriptsGate) return true;
            const original = App.start.bind(App);
            let args, released = false, started = false;
            const resume = () => { if (released && args && !started) { started = true; original(...args); } };
            App.start = (...values) => { args = values; resume(); };
            window.desktopScriptsGate = {token:${token}, release() { released = true; resume(); }};
            return true;
        })()`).catch(error => { report(error); return false; });
    });
    contents.on('did-finish-load', () => {
        const token = generation;
        if (started === token) return;
        started = token;
        load(token).catch(report);
    });
    async function load(token) {
        if (!await ready || token !== generation || contents.isDestroyed()) return;
        // Every renderer operation carries its document token. An old download may
        // finish after navigation, but it cannot run in the replacement document.
        const run = source => {
            if (token !== generation || contents.isDestroyed()) throw new Error('Document changed');
            return execute(`(() => { if (window.desktopScriptsGate?.token !== ${token}) return; ${source}\n})()`);
        };
        let result = {offline:true, failed:0, available:0, updated:0};
        const errors = [];
        try {
            const versions = {scripts:options.version, electron:options.electronVersion, package:options.packageVersion, client:'unknown (app.asar replaced)'};
            await run(`window.POKECLICKER_SCRIPTS_DESKTOP_VERSION=${JSON.stringify(options.version)}; window.desktopScriptsVersions=${JSON.stringify(versions)};`);
            await run(fs.readFileSync(path.join(__dirname, 'scripthandler.js'), 'utf8')+'\nwindow.DesktopScriptHandler = DesktopScriptHandler;');
            const checker = path.join(__dirname, 'desktopupdatechecker.js');
            if (fs.existsSync(checker)) await run(fs.readFileSync(checker, 'utf8'));
            const updateRequested = await run('return DesktopScriptHandler.updateScriptsNextLaunch();');
            const autoUpdate = await run('return DesktopScriptHandler.shouldScriptsAutoUpdate();');
            result = await updateScripts({...options, autoUpdate});
            result.desktopUpdateAvailable = !!(semver.valid(options.version) && semver.valid(result.latestDesktopVersion) && semver.gt(result.latestDesktopVersion, options.version));
            if (updateRequested && !result.offline && !result.failed) await run("localStorage.setItem('epheniaUpdateScriptsNextLaunch', 'false');");
            for (const [folder, custom] of [['scripts',false],['custom-scripts',true]]) {
                const directory = path.join(options.dataDir, folder);
                fs.mkdirSync(directory, {recursive:true});
                for (const file of listScripts(directory)) {
                    // Preserve historical toggle keys for repository scripts.
                    const name = custom ? file : file.split('.')[0];
                    try {
                        const enabled = await run(`DesktopScriptHandler.register${custom?'User':'Ephenia'}Script(${JSON.stringify(name)}); return DesktopScriptHandler.is${custom?'User':'Ephenia'}ScriptEnabled(${JSON.stringify(name)});`);
                        if (enabled) {
                            const body = fs.readFileSync(path.join(directory,file),'utf8');
                            await run(`(function(){\n${body}\n})();`);
                        }
                    } catch (error) { errors.push(file); report(error); }
                }
            }
        } catch (error) { errors.push(error.message); report(error); }
        finally {
            try {
                await run(`window.desktopScriptsStatus=${JSON.stringify({...result,errors})};
                    try { if (window.DesktopScriptHandler) DesktopScriptHandler.showStatus(); }
                    finally { window.desktopScriptsGate.release(); }`);
            } catch (error) { report(error); }
        }
    }
}
module.exports = {attachScriptsWindow, updateScripts, fetchText, atomicWrite};
