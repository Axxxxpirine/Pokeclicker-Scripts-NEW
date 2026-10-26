'use strict';
// Security policy reviewed 2026-10-27. Update the runtime floor with security releases.
const fs = require('fs');
const path = require('path');
const {fileURLToPath} = require('url');
const {randomUUID} = require('crypto');
const semver = require('semver');
const MIN_ELECTRON_VERSION = '45.0.0';
const WEB_PREFERENCES = Object.freeze({
    nodeIntegration:false,
    nodeIntegrationInWorker:false,
    nodeIntegrationInSubFrames:false,
    contextIsolation:true,
    sandbox:true,
    webSecurity:true,
    webviewTag:false,
    allowRunningInsecureContent:false,
    backgroundThrottling:false,
});
// Knockout's bundled bindings and the game's inline handlers require inline/eval.
// No remotely hosted JavaScript, embedded frames, plug-ins or form submissions.
const CSP = "default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://bootswatch.com https://fonts.googleapis.com; img-src 'self' data: blob: https://static.wixstatic.com https://img.shields.io https://avatars.githubusercontent.com https://a.deviantart.net https://www.smogon.com; font-src 'self' data: https://fonts.gstatic.com; media-src 'self' data: blob:; connect-src 'self' https://discord.pokeclicker.com https://translations.pokeclicker.com; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'; worker-src blob:";
const externalHosts = new Set(['github.com','www.pokeclicker.com','pokeclicker.com','wiki.pokeclicker.com','discord.gg','discord.com']);
const sessions = new WeakSet();
function isSupportedRuntime(version) {
    return !!semver.valid(version) && !semver.prerelease(version) && semver.gte(version, MIN_ELECTRON_VERSION);
}
function discordActivity(data) {
    if (!data || typeof data !== 'object' || data.enabled !== true) return null;
    const text = value => typeof value === 'string' && value.length > 1 ? value.slice(0,128) : '--';
    const activity = {instance:true,details:text(data.line1),state:text(data.line2)};
    if (Number.isFinite(data.startTimestamp) && data.startTimestamp >= 0) activity.startTimestamp = data.startTimestamp;
    for (const size of ['large','small']) {
        const key = data[`${size}ImageKey`];
        if (typeof key !== 'string' || !/^[a-zA-Z0-9_.-]{1,128}$/.test(key)) continue;
        activity[`${size}ImageKey`] = key;
        if (typeof data[`${size}ImageText`] === 'string') activity[`${size}ImageText`] = data[`${size}ImageText`].slice(0,128);
    }
    return activity;
}
function inside(candidate, root) {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function isAllowedLocalURL(value, roots) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'file:' || url.hostname || url.username || url.password) return false;
        const file = fileURLToPath(url);
        const physical = fs.realpathSync(file);
        return roots.some(root => {
            if (!inside(file, path.resolve(root)) || fs.lstatSync(root).isSymbolicLink()) return false;
            return inside(physical, fs.realpathSync(root));
        });
    } catch (_) { return false; }
}
function externalURL(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.port || !externalHosts.has(url.hostname)) return null;
        return url.href;
    } catch (_) { return null; }
}
function protectWindow(window, {indexFiles, openExternal}) {
    const contents = window.webContents;
    function navigate(event, value) {
        try {
            const url = new URL(value);
            if (url.protocol === 'file:' && !url.hostname && indexFiles.includes(fileURLToPath(url)) && isAllowedLocalURL(value,indexFiles.map(file=>path.dirname(file)))) return;
        } catch (_) { /* Deny malformed URLs. */ }
        event.preventDefault();
        // Normal links may open only known HTTPS destinations in the user's browser.
        const allowed = externalURL(value);
        if (allowed) Promise.resolve().then(()=>openExternal(allowed)).catch(()=>{});
    }
    contents.on('will-navigate',navigate);
    contents.on('will-redirect',event=>event.preventDefault());
    contents.on('will-attach-webview',event=>event.preventDefault());
    contents.setWindowOpenHandler(({url}) => {
        const allowed = externalURL(url);
        if (allowed) Promise.resolve().then(()=>openExternal(allowed)).catch(()=>{});
        return {action:'deny'};
    });
}
function protectSession(session, roots) {
    if (sessions.has(session)) return;
    sessions.add(session);
    session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    session.setPermissionCheckHandler(()=>false);
    session.webRequest.onBeforeRequest({urls:['file://*/*']}, (details,callback)=>callback({cancel:!isAllowedLocalURL(details.url,roots)}));
}
function protectGameIndex(file, trustedRoot) {
    if (typeof trustedRoot !== 'string' || !path.isAbsolute(trustedRoot)) throw new Error('An absolute trusted game root is required');
    const root = path.resolve(trustedRoot);
    file = path.resolve(file);
    if (file === root || !inside(file, root)) throw new Error('Game index is outside its trusted root');
    // The caller chooses the root. Every component below it must be a real
    // directory/file so patching cannot follow a relocated game path outside it.
    let current = root, stat;
    for (const component of path.relative(root, file).split(path.sep)) {
        current = path.join(current, component);
        stat = fs.lstatSync(current);
        if (stat.isSymbolicLink()) throw new Error('Game index path cannot contain a symbolic link');
        if (current !== file && !stat.isDirectory()) throw new Error('Invalid game index directory');
    }
    if (!stat.isFile()) throw new Error('Game index must be a regular file');
    if (stat.size > 8 * 1024 * 1024) throw new Error('Game index is too large');
    const original = fs.readFileSync(file,'utf8');
    const policy = `<meta data-desktop-security="1" http-equiv="Content-Security-Policy" content="${CSP}">`;
    const marker = /<meta\s+data-desktop-security="1"\s+http-equiv="Content-Security-Policy"\s+content="[^"]*"\s*>/g;
    const html = original.replace(marker,'');
    if (!/<head\b[^>]*>/i.test(html)) throw new Error('Game index has no HTML head');
    const protectedHTML = html.replace(/<head\b[^>]*>/i, head=>head+policy);
    if (original === protectedHTML) return;
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporary,protectedHTML,{encoding:'utf8',flag:'wx',mode:0o600});
        fs.renameSync(temporary,file);
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}
module.exports = {MIN_ELECTRON_VERSION,WEB_PREFERENCES,CSP,isSupportedRuntime,isAllowedLocalURL,externalURL,protectWindow,protectSession,protectGameIndex,discordActivity};
