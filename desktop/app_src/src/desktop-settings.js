'use strict';
const path = require('path');
const fs = require('fs');
const sessions = new WeakSet();
function normalizeSettings(value) {
    const config = value && typeof value === 'object' ? value : {};
    const sizing = config.Sizing;
    if (!sizing || !Number.isFinite(+sizing.Width) || !Number.isFinite(+sizing.Height)
        || +sizing.Width < 300 || +sizing.Height < 200 || +sizing.Width > 16000 || +sizing.Height > 16000
        || typeof sizing.Maximized !== 'boolean') {
        config.Sizing = {Width:800, Height:600, Maximized:false};
    }
    return config;
}
function rememberDownloads(session, config, save) {
    if (sessions.has(session)) return;
    sessions.add(session);
    session.on('will-download', (_event, item) => {
        const directory = config.Downloads?.Directory;
        if (typeof directory === 'string' && path.isAbsolute(directory) && fs.existsSync(directory)) {
            item.setSaveDialogOptions({defaultPath:path.join(directory, path.basename(item.getFilename()))});
        }
        item.once('done', (_event, state) => {
            if (state !== 'completed' || !item.getSavePath()) return;
            config.Downloads = {...config.Downloads, Directory:path.dirname(item.getSavePath())};
            save();
        });
    });
}
module.exports = {normalizeSettings, rememberDownloads};
