'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const {randomUUID} = require('crypto');
const Zip = require('adm-zip');
const semver = require('semver');
const {protectGameIndex} = require('./desktop-security');

const VERSION_URL = 'https://raw.githubusercontent.com/pokeclicker/pokeclicker/master/package.json';
const ARCHIVE_URL = 'https://codeload.github.com/pokeclicker/pokeclicker/zip/master';
const DEFAULT_LIMITS = Object.freeze({
    metadataBytes: 64 * 1024,
    metadataTimeoutMs: 15 * 1000,
    archiveBytes: 512 * 1024 * 1024,
    archiveTimeoutMs: 10 * 60 * 1000,
    entries: 100000,
    fileBytes: 64 * 1024 * 1024,
    totalBytes: 2 * 1024 * 1024 * 1024,
});

function boundedLimits(overrides = {}) {
    const limits = {...DEFAULT_LIMITS};
    for (const [key, value] of Object.entries(overrides)) {
        if (!(key in limits) || !Number.isSafeInteger(value) || value <= 0 || value > limits[key]) {
            throw new Error('Invalid game update limit');
        }
        limits[key] = value;
    }
    return limits;
}

function report(callback, stage, data = {}) {
    // UI progress must not interrupt validation or rollback.
    try { Promise.resolve(callback?.(stage, data)).catch(() => {}); } catch (_) {}
}

function download(url, {request, maxBytes, timeoutMs, destination, onProgress}) {
    return new Promise((resolve, reject) => {
        let req, response, descriptor, received = 0, settled = false;
        const chunks = [];
        const timer = setTimeout(() => finish(new Error('Game update download deadline exceeded')), timeoutMs);
        function finish(error) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (descriptor !== undefined) {
                try { fs.closeSync(descriptor); } catch (closeError) { error ||= closeError; }
                descriptor = undefined;
            }
            if (error) {
                response?.destroy();
                req?.destroy();
                reject(error);
            } else resolve(destination ? received : Buffer.concat(chunks, received));
        }
        try {
            if (destination) descriptor = fs.openSync(destination, 'wx', 0o600);
            req = request(url, {headers:{'Accept-Encoding':'identity', 'User-Agent':'Pokeclicker-Scripts-Desktop'}}, res => {
                response = res;
                if (settled) { res.destroy(); return; }
                res.on('error', finish);
                res.on('aborted', () => finish(new Error('Game update response aborted')));
                res.on('close', () => {
                    if (!settled) finish(new Error('Game update response closed prematurely'));
                });
                if (res.statusCode !== 200) return finish(new Error(`Game update HTTP status ${res.statusCode}`));
                if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') {
                    return finish(new Error('Unexpected game update content encoding'));
                }
                const length = res.headers['content-length'];
                const total = length === undefined ? undefined : Number(length);
                if (length !== undefined && (!/^\d+$/.test(length) || !Number.isSafeInteger(total) || total > maxBytes)) {
                    return finish(new Error('Game update response exceeds download limit'));
                }
                res.on('data', chunk => {
                    if (settled) return;
                    try {
                        received += chunk.length;
                        if (received > maxBytes || (total !== undefined && received > total)) {
                            throw new Error('Game update response exceeds download limit');
                        }
                        if (descriptor === undefined) chunks.push(chunk);
                        else {
                            let offset = 0;
                            while (offset < chunk.length) offset += fs.writeSync(descriptor, chunk, offset, chunk.length - offset);
                        }
                        report(onProgress, 'download', {received, total});
                    } catch (error) { finish(error); }
                });
                res.on('end', () => {
                    if (res.complete !== true || (total !== undefined && received !== total)) {
                        finish(new Error('Incomplete game update response'));
                    } else finish();
                });
            });
            req.on('error', finish);
        } catch (error) { finish(error); }
    });
}

function parseVersion(contents) {
    const data = JSON.parse(contents.toString('utf8'));
    const version = data?.version;
    if (typeof version !== 'string' || semver.valid(version) !== version) {
        throw new Error('Invalid game update version');
    }
    return version;
}

async function fetchGameVersion({request = https.get, limits: overrides} = {}) {
    const limits = boundedLimits(overrides);
    const data = await download(VERSION_URL, {
        request, maxBytes:limits.metadataBytes, timeoutMs:limits.metadataTimeoutMs,
    });
    return parseVersion(data);
}

function checkGamePath(dataDir) {
    for (const relative of ['pokeclicker-master', 'pokeclicker-master/docs']) {
        try {
            const stat = fs.lstatSync(path.join(dataDir, relative));
            if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Unsafe installed game path');
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
}

function lockOwner(lock, allowedNames = ['owner.json']) {
    const directory = fs.lstatSync(lock);
    if (directory.isSymbolicLink() || !directory.isDirectory()) throw new Error('Ambiguous game update lock');
    const names = fs.readdirSync(lock).sort();
    if (JSON.stringify(names) !== JSON.stringify([...allowedNames].sort())) throw new Error('Ambiguous game update lock contents');
    const ownerPath = path.join(lock, 'owner.json');
    const stat = fs.lstatSync(ownerPath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 256) throw new Error('Ambiguous game update lock owner');
    const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
    if (owner.version !== 1 || !Number.isSafeInteger(owner.pid) || owner.pid <= 0
        || Object.keys(owner).some(key => !['version', 'pid', 'token'].includes(key))) {
        throw new Error('Invalid game update lock owner');
    }
    return {directory, owner};
}

function ownerHasExited(pid) {
    try { process.kill(pid, 0); }
    catch (error) { return error.code === 'ESRCH'; }
    return false;
}

function sameDirectory(left, right) {
    return left.dev === right.dev && left.ino === right.ino;
}

function reclaimDeadLock(base, lock) {
    let claim, quarantine, claimed = false, moved = false;
    try {
        claim = lockOwner(lock);
        if (!ownerHasExited(claim.owner.pid)) return false;
        // Serialize reclamation across cooperating processes before moving a stale lock.
        // Missing/partial owner records and interrupted reclamations remain untouched.
        fs.mkdirSync(path.join(lock, 'reclaim'), {mode:0o700});
        claimed = true;
        const checked = lockOwner(lock, ['owner.json', 'reclaim']);
        if (!sameDirectory(claim.directory, checked.directory)
            || JSON.stringify(claim.owner) !== JSON.stringify(checked.owner)
            || !ownerHasExited(checked.owner.pid)) return false;
        quarantine = fs.mkdtempSync(path.join(base, '.pokeclicker-stale-lock-'));
        const retired = path.join(quarantine, 'lock');
        fs.renameSync(lock, retired);
        moved = true;
        // Remove only the exact known lock files, never a recursive or ambiguous path.
        fs.unlinkSync(path.join(retired, 'owner.json'));
        fs.rmdirSync(path.join(retired, 'reclaim'));
        fs.rmdirSync(retired);
        fs.rmdirSync(quarantine);
        quarantine = undefined;
        return true;
    } catch (_) { return false; }
    finally {
        if (claimed && !moved) {
            try {
                if (sameDirectory(claim.directory, fs.lstatSync(lock))) fs.rmdirSync(path.join(lock, 'reclaim'));
            } catch (_) {}
        }
        if (quarantine && !moved) { try { fs.rmdirSync(quarantine); } catch (_) {} }
    }
}

function acquireUpdateLock(base) {
    const lock = path.join(base, '.pokeclicker-update.lock');
    try { fs.mkdirSync(lock, {mode:0o700}); }
    catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (!reclaimDeadLock(base, lock)) throw new Error('A game update is already in progress or its lock owner is unknown');
        try { fs.mkdirSync(lock, {mode:0o700}); }
        catch (_) { throw new Error('Another game update acquired the update lock'); }
    }
    const token = randomUUID();
    try {
        fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({version:1, pid:process.pid, token}), {flag:'wx', mode:0o600});
    } catch (error) {
        // A partial owner file is deliberately left for inspection after a write error.
        try { fs.rmdirSync(lock); } catch (_) {}
        throw error;
    }
    const directory = fs.lstatSync(lock);
    return () => {
        const current = lockOwner(lock);
        if (!sameDirectory(directory, current.directory) || current.owner.token !== token) throw new Error('Game update lock ownership changed');
        fs.unlinkSync(path.join(lock, 'owner.json'));
        fs.rmdirSync(lock);
    };
}

function safeEntryName(name) {
    if (!name || name.startsWith('/') || /[\\:\x00-\x1f]/.test(name)) throw new Error('Unsafe game archive path');
    const parts = name.replace(/\/$/, '').split('/');
    if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)
        || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
        throw new Error('Unsafe game archive path');
    }
    return parts;
}

function stageGame(archivePath, gamePath, limits) {
    const zip = new Zip(archivePath);
    if (zip.getEntryCount() > limits.entries) throw new Error('Game archive has too many entries');
    const entries = zip.getEntries();
    if (entries.length > limits.entries) throw new Error('Game archive has too many entries');
    const names = new Map(), selected = [];
    let declared = 0;
    for (const entry of entries) {
        const name = entry.entryName;
        const parts = safeEntryName(name);
        const kind = (entry.attr >>> 16) & 0o170000;
        if (kind && kind !== 0o100000 && kind !== 0o040000) throw new Error('Unsafe game archive file type');
        const key = parts.join('/').normalize('NFC').toLowerCase();
        if (names.has(key)) throw new Error('Duplicate or case-colliding game archive path');
        names.set(key, {name:parts.join('/'), directory:entry.isDirectory});
        if (!name.startsWith('pokeclicker-master/docs/')) continue;
        if (entry.isDirectory) continue;
        if (entry.header.encrypted || ![0, 8].includes(entry.header.method)) throw new Error('Unsupported game archive entry');
        const size = entry.header.size;
        if (!Number.isSafeInteger(size) || size < 0 || size > limits.fileBytes) throw new Error('Game archive file exceeds size limit');
        if (entry.header.method === 0 && entry.header.compressedSize !== size) {
            throw new Error('Stored game archive size does not match its declaration');
        }
        declared += size;
        if (declared > limits.totalBytes) throw new Error('Game archive exceeds extracted size limit');
        selected.push({entry, relative:parts.slice(1).join('/')});
    }
    for (const {name} of [...names.values()]) {
        const parts = name.split('/');
        for (let i = 1; i < parts.length; i++) {
            const parent = parts.slice(0, i).join('/');
            const key = parent.normalize('NFC').toLowerCase();
            const found = names.get(key);
            if (found && (!found.directory || found.name !== parent)) throw new Error('Conflicting game archive parent path');
            if (!found) names.set(key, {name:parent, directory:true});
        }
    }
    fs.mkdirSync(gamePath, {mode:0o700});
    let actual = 0;
    for (const {entry, relative} of selected) {
        // adm-zip 0.6.1 caps inflation at the checked declared size on supported Node runtimes.
        const contents = entry.getData();
        actual += contents.length;
        if (contents.length !== entry.header.size || contents.length > limits.fileBytes || actual > limits.totalBytes) {
            throw new Error('Game archive extracted size does not match its declaration');
        }
        const destination = path.join(gamePath, relative);
        fs.mkdirSync(path.dirname(destination), {recursive:true, mode:0o700});
        fs.writeFileSync(destination, contents, {flag:'wx', mode:0o600});
    }
    const index = path.join(gamePath, 'docs/index.html');
    if (!fs.statSync(index).isFile() || fs.statSync(index).size === 0) throw new Error('Missing game index');
    const metadata = path.join(gamePath, 'docs/package.json');
    if (fs.statSync(metadata).size > limits.metadataBytes) throw new Error('Game metadata exceeds size limit');
    return parseVersion(fs.readFileSync(metadata));
}

async function installGameUpdate({dataDir, request = https.get, onProgress, limits: overrides} = {}) {
    const limits = boundedLimits(overrides);
    if (typeof dataDir !== 'string' || !dataDir) throw new Error('Game data directory is required');
    fs.mkdirSync(dataDir, {recursive:true});
    const base = fs.realpathSync(dataDir);
    checkGamePath(base);
    const releaseLock = acquireUpdateLock(base);
    let temporary, movedOld = false, preserveRecovery = false;
    const destination = path.join(base, 'pokeclicker-master');
    try {
        temporary = fs.mkdtempSync(path.join(base, '.pokeclicker-update-'));
        const archive = path.join(temporary, 'update.zip');
        await download(ARCHIVE_URL, {
            request, maxBytes:limits.archiveBytes, timeoutMs:limits.archiveTimeoutMs,
            destination:archive, onProgress,
        });
        report(onProgress, 'validate');
        const game = path.join(temporary, 'game');
        const version = stageGame(archive, game, limits);
        protectGameIndex(path.join(game, 'docs/index.html'), temporary);
        checkGamePath(base);
        report(onProgress, 'install');
        const previous = path.join(temporary, 'previous');
        try { fs.renameSync(destination, previous); movedOld = true; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        try { fs.renameSync(game, destination); }
        catch (error) {
            if (movedOld) {
                try { fs.renameSync(previous, destination); movedOld = false; }
                catch (rollbackError) {
                    preserveRecovery = true;
                    throw new Error(`Game update rollback failed. Previous game retained in ${previous}: ${rollbackError.message}`);
                }
            }
            throw error;
        }
        report(onProgress, 'complete', {version});
        return version;
    } finally {
        // Never delete the prior installation if an OS error prevented rollback.
        try { if (temporary && !preserveRecovery) fs.rmSync(temporary, {recursive:true, force:true}); }
        finally { releaseLock(); }
    }
}

module.exports = {fetchGameVersion, installGameUpdate};
