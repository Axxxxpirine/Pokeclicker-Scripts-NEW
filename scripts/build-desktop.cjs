const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
const stage = path.join(root, '.local/desktop-build');
(async () => {
    fs.rmSync(stage, {recursive:true, force:true});
    fs.cpSync(path.join(root,'desktop/app_src'), stage, {
        recursive:true,
        verbatimSymlinks:true,
        filter: source => !['.bin', '.package-lock.json'].includes(path.basename(source)),
    });
    fs.copyFileSync(path.join(root,'LICENSE'),path.join(stage,'LICENSE-GPL-3.0.txt'));
    const bundled = path.join(stage,'bundled-scripts');
    fs.mkdirSync(bundled,{recursive:true});
    for (const directory of [root, path.join(root,'custom')]) {
        for (const filename of fs.readdirSync(directory).sort()) {
            if (filename.endsWith('.user.js')) fs.copyFileSync(path.join(directory,filename),path.join(bundled,filename));
        }
    }
    fs.copyFileSync(path.join(root,'desktopupdatechecker.js'),path.join(stage,'src/desktopupdatechecker.js'));
    await asar.createPackage(stage,path.join(root,'desktop/app.asar'));
    console.log(`Built desktop/app.asar with ${fs.readdirSync(bundled).length} bundled scripts`);
})().catch(error=>{console.error(error);process.exitCode=1;});
