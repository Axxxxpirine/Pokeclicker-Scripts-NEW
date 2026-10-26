const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {PassThrough} = require('node:stream');
const Zip = require('../desktop/app_src/node_modules/adm-zip');
const helper = path.resolve(__dirname, '../desktop/app_src/src/desktop-game-updater.js');
const NEW_GAME = '<!doctype html><html><head><title>new game</title></head><body>new game</body></html>';
const api = () => require(helper);
function fixture(t) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokeclicker-updater-'));
    t.after(() => fs.rmSync(dataDir, {recursive:true, force:true}));
    const docs = path.join(dataDir, 'pokeclicker-master/docs');
    fs.mkdirSync(docs, {recursive:true});
    fs.writeFileSync(path.join(docs, 'index.html'), 'old game');
    fs.writeFileSync(path.join(dataDir, 'save.json'), 'private save');
    return {dataDir, docs};
}
function archive(extra = [], version = '0.10.26') {
    const zip = new Zip();
    zip.addFile('pokeclicker-master/docs/index.html', Buffer.from(NEW_GAME));
    zip.addFile('pokeclicker-master/docs/package.json', Buffer.from(JSON.stringify({version})));
    for (const [name, contents, attrs] of extra) {
        zip.addFile(name, Buffer.from(contents));
        if (attrs !== undefined) zip.getEntry(name).attr = attrs >>> 0;
    }
    return zip.toBuffer();
}
function response(body, options = {}) {
    return (url, requestOptions, callback) => {
        assert.ok(url.startsWith('https://'));
        const req = new EventEmitter();
        req.destroy = () => {};
        process.nextTick(() => {
            if (options.stall) return;
            const res = new PassThrough();
            res.statusCode = options.status || 200;
            res.headers = options.headers || {'content-length':String(body.length)};
            res.complete = options.complete !== false;
            callback(res);
            if (options.aborted) { res.emit('aborted'); res.destroy(); }
            else res.end(body);
        });
        return req;
    };
}
function unchanged(f) {
    assert.equal(fs.readFileSync(path.join(f.docs, 'index.html'), 'utf8'), 'old game');
    assert.equal(fs.readFileSync(path.join(f.dataDir, 'save.json'), 'utf8'), 'private save');
    assert.deepEqual(fs.readdirSync(f.dataDir).sort(), ['pokeclicker-master', 'save.json']);
}
test('game updater exposes bounded metadata and transactional install operations', () => {
    assert.ok(fs.existsSync(helper), 'the hardened updater must exist');
    assert.equal(typeof api().fetchGameVersion, 'function');
    assert.equal(typeof api().installGameUpdate, 'function');
});
test('metadata uses the official HTTPS endpoint and validates the version', async () => {
    const request = response(Buffer.from('{"version":"0.10.26"}'));
    assert.equal(await api().fetchGameVersion({request:(url, opts, cb) => {
        assert.equal(url, 'https://raw.githubusercontent.com/pokeclicker/pokeclicker/master/package.json');
        return request(url, opts, cb);
    }}), '0.10.26');
    for (const body of ['bad JSON', '{"version":"<img>"}', '{"version":5}', '{"version":"v1.2.3"}']) {
        await assert.rejects(api().fetchGameVersion({request:response(Buffer.from(body))}));
    }
});
test('metadata rejects redirects, errors, truncation, oversize bodies and timeouts', async () => {
    const body = Buffer.from('{"version":"0.10.26"}');
    for (const options of [{status:302}, {status:404}, {complete:false}, {aborted:true}, {headers:{'content-length':'200'}}, {headers:{'content-encoding':'gzip'}}]) {
        await assert.rejects(api().fetchGameVersion({request:response(body, options)}));
    }
    await assert.rejects(api().fetchGameVersion({request:response(body), limits:{metadataBytes:5}}));
    await assert.rejects(api().fetchGameVersion({request:response(body, {stall:true}), limits:{metadataTimeoutMs:10}}));
});
test('valid update replaces the game only and reports its actual archive version', async t => {
    const f = fixture(t), stages = [];
    const request = response(archive([['pokeclicker-master/docs/assets/a.txt', 'asset'], ['pokeclicker-master/src/private.txt', 'excluded']]));
    assert.equal(await api().installGameUpdate({...f, request:(url, opts, cb) => {
        assert.equal(url, 'https://codeload.github.com/pokeclicker/pokeclicker/zip/master');
        return request(url, opts, cb);
    }, onProgress:(stage) => stages.push(stage)}), '0.10.26');
    assert.match(fs.readFileSync(path.join(f.docs, 'index.html'), 'utf8'), /<title>new game<\/title>/);
    assert.equal(fs.readFileSync(path.join(f.docs, 'assets/a.txt'), 'utf8'), 'asset');
    assert.equal(fs.readFileSync(path.join(f.dataDir, 'save.json'), 'utf8'), 'private save');
    assert.equal(fs.existsSync(path.join(f.dataDir, 'pokeclicker-master/src')), false);
    assert.ok(stages.includes('download') && stages.includes('complete'));
    assert.deepEqual(fs.readdirSync(f.dataDir).sort(), ['pokeclicker-master', 'save.json']);
});
test('bad HTTP and corrupt ZIP downloads leave the installed game and save intact', async t => {
    const f = fixture(t), body = archive();
    for (const options of [{status:302}, {status:500}, {complete:false}, {aborted:true}, {headers:{'content-length':String(body.length + 1)}}]) {
        await assert.rejects(api().installGameUpdate({...f, request:response(body, options)})); unchanged(f);
    }
    for (const damaged of [Buffer.from('not zip'), body.subarray(0, body.length - 30)]) {
        await assert.rejects(api().installGameUpdate({...f, request:response(damaged)})); unchanged(f);
    }
});
test('declared and streamed download and extraction limits preserve the installed game', async t => {
    const f = fixture(t), body = archive([['pokeclicker-master/docs/large.txt', 'x'.repeat(100)]]);
    for (const limits of [{archiveBytes:10}, {fileBytes:50}, {totalBytes:80}, {entries:2}]) {
        await assert.rejects(api().installGameUpdate({...f, request:response(body), limits})); unchanged(f);
    }
    await assert.rejects(api().installGameUpdate({...f, request:response(body, {headers:{}}), limits:{archiveBytes:10}})); unchanged(f);
    await assert.rejects(api().installGameUpdate({...f, request:response(body, {stall:true}), limits:{archiveTimeoutMs:10}})); unchanged(f);
});
function renameEntry(buffer, from, to) {
    assert.equal(Buffer.byteLength(from), Buffer.byteLength(to));
    return Buffer.from(buffer.toString('latin1').split(from).join(to), 'latin1');
}
test('unsafe ZIP paths, symlinks and case collisions cannot escape staging', async t => {
    const f = fixture(t);
    const source = 'pokeclicker-master/docs/aa/b.txt';
    const good = archive([[source, 'bad']]);
    const cases = [
        renameEntry(good, source, 'pokeclicker-master/docs/../b.txt'),
        renameEntry(good, source, 'pokeclicker-master/docs/aa\\b.txt'),
        renameEntry(good, source, 'pokeclicker-master/docs/aa:b.txt'),
        renameEntry(good, source, 'pokeclicker-master/docs/aa\0b.txt'),
        archive([['pokeclicker-master/docs/INDEX.html', 'bad']]),
        archive([['pokeclicker-master/docs/link', 'outside', 0o120777 << 16]]),
    ];
    for (const body of cases) {
        await assert.rejects(api().installGameUpdate({...f, request:response(body)})); unchanged(f);
    }
});
test('missing required game files and invalid archive versions preserve the installed game', async t => {
    const f = fixture(t), zip = new Zip();
    zip.addFile('pokeclicker-master/docs/other.txt', Buffer.from('other'));
    for (const body of [zip.toBuffer(), archive([], 'not-a-version')]) {
        await assert.rejects(api().installGameUpdate({...f, request:response(body)})); unchanged(f);
    }
});
test('an installed game symlink is rejected without touching its destination', async t => {
    const f = fixture(t), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pokeclicker-outside-'));
    t.after(() => fs.rmSync(outside, {recursive:true, force:true}));
    fs.writeFileSync(path.join(outside, 'index.html'), 'outside');
    fs.rmSync(f.docs, {recursive:true}); fs.symlinkSync(outside, f.docs, 'junction');
    await assert.rejects(api().installGameUpdate({...f, request:response(archive())}));
    assert.equal(fs.readFileSync(path.join(outside, 'index.html'), 'utf8'), 'outside');
    assert.equal(fs.lstatSync(f.docs).isSymbolicLink(), true);
});
test('parallel installation is rejected and failed promotion restores the prior game', async t => {
    const f = fixture(t);
    const pending = api().installGameUpdate({...f, request:response(archive(), {stall:true}), limits:{archiveTimeoutMs:30}});
    await assert.rejects(api().installGameUpdate({...f, request:response(archive())}), /already|progress|lock/i);
    await assert.rejects(pending); unchanged(f);
    const original = fs.renameSync;
    fs.renameSync = (from, to) => {
        if (path.basename(from) === 'game' && path.basename(to) === 'pokeclicker-master') throw Error('injected disk failure');
        return original(from, to);
    };
    try { await assert.rejects(api().installGameUpdate({...f, request:response(archive())}), /disk failure/); }
    finally { fs.renameSync = original; }
    unchanged(f);
});

test('duplicate ZIP entries and inconsistent uncompressed sizes are rejected before installation', async t => {
    const f = fixture(t);
    const zip = new Zip();
    zip.addFile('pokeclicker-master/docs/index.html', Buffer.from('new game'));
    zip.addFile('pokeclicker-master/docs/package.json', Buffer.from('{"version":"0.10.26"}'));
    zip.addFile('pokeclicker-master/docs/a.txt', Buffer.from('x'.repeat(100)));
    zip.addFile('pokeclicker-master/docs/b.txt', Buffer.from('other'));
    const original = zip.toBuffer();
    const duplicate = renameEntry(original, 'pokeclicker-master/docs/b.txt', 'pokeclicker-master/docs/a.txt');
    await assert.rejects(api().installGameUpdate({...f, request:response(duplicate)})); unchanged(f);
    for (const declared of [0, 1, 101, 0xffffffff]) {
        const body = Buffer.from(original);
        let offset = 0;
        while ((offset = body.indexOf(Buffer.from('504b0102', 'hex'), offset)) !== -1) {
            const length = body.readUInt16LE(offset + 28);
            if (body.subarray(offset + 46, offset + 46 + length).toString() === 'pokeclicker-master/docs/a.txt') {
                body.writeUInt32LE(declared, offset + 24);
                break;
            }
            offset += 4;
        }
        await assert.rejects(api().installGameUpdate({...f, request:response(body)})); unchanged(f);
    }
});

test('case mismatched directory components and file-directory conflicts are rejected', async t => {
    const f = fixture(t);
    for (const files of [
        [['pokeclicker-master/docs/assets/a.txt', 'a'], ['pokeclicker-master/docs/ASSETS/b.txt', 'b']],
        [['pokeclicker-master/docs/assets', 'a'], ['pokeclicker-master/docs/assets/b.txt', 'b']],
    ]) {
        await assert.rejects(api().installGameUpdate({...f, request:response(archive(files))})); unchanged(f);
    }
});

test('observer errors cannot corrupt installation and rejected requests clean staging', async t => {
    const f = fixture(t);
    await assert.rejects(api().installGameUpdate({...f, request:() => { throw Error('network setup failure'); }})); unchanged(f);
    await assert.rejects(api().installGameUpdate({...f, request:() => {
        const req = new EventEmitter(); req.destroy = () => {};
        process.nextTick(() => req.emit('error', Error('network failed'))); return req;
    }})); unchanged(f);
    assert.equal(await api().installGameUpdate({...f, request:response(archive()), onProgress:() => {throw Error('closed UI');}}), '0.10.26');
});

test('a crashed process lock is reclaimed before a new update and cleaned after success', async t => {
    const f = fixture(t);
    const child = require('node:child_process').spawnSync(process.execPath, ['-e', '']);
    assert.equal(child.status, 0);
    const lock = path.join(f.dataDir, '.pokeclicker-update.lock');
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({version:1, pid:child.pid}));
    assert.equal(await api().installGameUpdate({...f, request:response(archive())}), '0.10.26');
    assert.deepEqual(fs.readdirSync(f.dataDir).sort(), ['pokeclicker-master', 'save.json']);
    assert.equal(fs.readFileSync(path.join(f.dataDir, 'save.json'), 'utf8'), 'private save');
});

test('live, incomplete and ambiguous updater locks remain untouched', async t => {
    const f = fixture(t), lock = path.join(f.dataDir, '.pokeclicker-update.lock');
    const child = require('node:child_process').spawnSync(process.execPath, ['-e', '']);
    assert.equal(child.status, 0);
    for (const contents of [JSON.stringify({version:1, pid:process.pid}), 'invalid JSON', null, JSON.stringify({version:1, pid:child.pid})]) {
        fs.mkdirSync(lock);
        if (contents !== null) fs.writeFileSync(path.join(lock, 'owner.json'), contents);
        if (contents?.includes(String(child.pid))) fs.writeFileSync(path.join(lock, 'unknown.txt'), 'retain');
        const before = fs.readdirSync(lock).map(name => [name, fs.readFileSync(path.join(lock, name), 'utf8')]);
        await assert.rejects(api().installGameUpdate({...f, request:response(archive())}), /lock|progress/i);
        assert.deepEqual(fs.readdirSync(lock).map(name => [name, fs.readFileSync(path.join(lock, name), 'utf8')]), before);
        fs.rmSync(lock, {recursive:true}); unchanged(f);
    }
});

test('Windows-style busy game directory failure preserves the old game and removes the update lock', async t => {
    const f = fixture(t), original = fs.renameSync;
    fs.renameSync = (from, to) => {
        if (path.basename(from) === 'pokeclicker-master') throw Object.assign(Error('directory busy'), {code:'EPERM'});
        return original(from, to);
    };
    try { await assert.rejects(api().installGameUpdate({...f, request:response(archive())}), /busy/); }
    finally { fs.renameSync = original; }
    unchanged(f);
});

test('HTML security policy is installed before promotion and invalid HTML preserves the old game', async t => {
    const f = fixture(t), zip = new Zip();
    zip.addFile('pokeclicker-master/docs/index.html', Buffer.from('<html><body>no head</body></html>'));
    zip.addFile('pokeclicker-master/docs/package.json', Buffer.from('{"version":"0.10.26"}'));
    await assert.rejects(api().installGameUpdate({...f, request:response(zip.toBuffer())}), /HTML head/); unchanged(f);
    await api().installGameUpdate({...f, request:response(archive())});
    const html = fs.readFileSync(path.join(f.docs, 'index.html'), 'utf8');
    assert.match(html, /<head><meta data-desktop-security="1" http-equiv="Content-Security-Policy"/);
});
