"use strict";

/* eslint-disable no-console */

const { app, BrowserWindow, dialog, shell } = require("electron");
const {MIN_ELECTRON_VERSION, WEB_PREFERENCES, isSupportedRuntime, discordActivity, protectWindow, protectSession, protectGameIndex} = require('./desktop-security');
if (!isSupportedRuntime(process.versions.electron)) {
  app.whenReady().then(() => {
    dialog.showErrorBox('Unsupported desktop runtime', `This security release requires Electron ${MIN_ELECTRON_VERSION} or later. Installed: ${process.versions.electron || 'unknown'}. Replacing app.asar cannot update Electron. Use the maintained runtime instructions in this fork or play in your browser.`);
    app.exit(1);
  });
  return;
}
const DiscordRPC = require("discord-rpc");
const fs = require("fs");
const electron = require("electron");
// app.getVersion() comes from the replacement archive, not the installed client.
const modifiedPackageVersion = app.getVersion();
const clientVersion = 'unknown (modified desktop package)';

const dataDir = (electron.app || electron.remote.app).getPath("userData");

// Used for Ephenia scripts
const path = require("path");
const ini = require("ini");
const {attachScriptsWindow, atomicWrite} = require('./desktop-scripts');
const {normalizeSettings, rememberDownloads} = require('./desktop-settings');
const {fetchGameVersion, installGameUpdate} = require('./desktop-game-updater');
const settingsFile = path.join(dataDir, "settings.ini");
const POKECLICKER_SCRIPTS_DESKTOP_VERSION = '3.0.0';

console.info("Data directory:", dataDir);

let checkForUpdatesInterval;
let newVersion = "0.0.0";
let currentVersion = "0.0.0";
let windowClosed = false;

let mainWindow;

/* DESKTOP SCRIPTS ADDITION */

let config;
let minWindowWidth = 300;
let minWindowHeight = 200;

try { config = ini.parse(fs.readFileSync(settingsFile, 'utf8')); }
catch (error) { console.info('Using default window settings:', error.code || error.message); }
config = normalizeSettings(config);
function saveSettings() {
  try {
    fs.mkdirSync(dataDir, {recursive:true});
    atomicWrite(settingsFile, ini.stringify(config));
  } catch (error) { console.warn('Cannot save desktop settings:', error.message); }
}

/* END DESKTOP SCRIPTS ADDITION */

function createWindow() {
  // Set the Application for Desktop notifications (windows only)
  try {
    app.setAppUserModelId("PokéClicker");
  } catch (e) {}

  mainWindow = new BrowserWindow({
    icon: __dirname + "/icon.png",
    minWidth: minWindowWidth,
    minHeight: minWindowHeight,
    width: +config.Sizing.Width,    // DESKTOP SCRIPTS ADDITION
    height: +config.Sizing.Height,  // DESKTOP SCRIPTS ADDITION
    resizable: true,                // DESKTOP SCRIPTS ADDITION
    webPreferences: {...WEB_PREFERENCES},
  });

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents
      .executeJavaScript(
        `(() => { DiscordRichPresence.clientVersion = '${clientVersion}' })()`
      )
      .catch((e) => {});
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.setTitle("PokéClicker");

  injectDesktopScriptsModifications(mainWindow);

  // Check if we've already downloaded the data, otherwise load our loading screen
  if (fs.existsSync(`${dataDir}/pokeclicker-master/docs/index.html`)) {
    try { protectGameIndex(path.join(dataDir, 'pokeclicker-master/docs/index.html'), dataDir); }
    catch (error) {
      dialog.showErrorBox('Cannot safely open the cached game', `The cached game could not be validated: ${error.message}. No game was loaded. Repair or replace the cached game files before restarting. Save data has not been changed.`);
      app.quit();
      return;
    }
    mainWindow.loadFile(path.join(dataDir, 'pokeclicker-master/docs/index.html'));
  } else {
    mainWindow.loadFile(path.join(__dirname, 'pokeclicker-master/docs/index.html'));
  }


  mainWindow.on("close", (event) => {
    windowClosed = true;
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.on("page-title-updated", function (e) {
    e.preventDefault();
  });
}

function createSecondaryWindow() {
  let newWindow = new BrowserWindow({
    icon: __dirname + "/icon.png",
    minWidth: minWindowWidth,
    minHeight: minWindowHeight,
    width: +config.Sizing.Width,    // DESKTOP SCRIPTS ADDITION
    height: +config.Sizing.Height,   // DESKTOP SCRIPTS ADDITION
    resizable: true,                // DESKTOP SCRIPTS ADDITION
    webPreferences: {...WEB_PREFERENCES},
  });

  newWindow.setMenuBarVisibility(false);
  newWindow.setTitle("PokéClicker (alternate)");
  injectDesktopScriptsModifications(newWindow);

  // Check if we've already downloaded the data, otherwise load our loading screen
  if (fs.existsSync(`${dataDir}/pokeclicker-master/docs/index.html`)) {
    try { protectGameIndex(path.join(dataDir, 'pokeclicker-master/docs/index.html'), dataDir); }
    catch (error) {
      dialog.showErrorBox('Cannot safely open the cached game', `The cached game could not be validated: ${error.message}. No game was loaded in the alternate window. Repair or replace the cached game files before reopening it. Save data has not been changed.`);
      newWindow.destroy();
      return null;
    }
    newWindow.loadFile(path.join(dataDir, 'pokeclicker-master/docs/index.html'));
  } else {
    newWindow.loadFile(path.join(__dirname, 'pokeclicker-master/docs/index.html'));
  }


  newWindow.on("closed", () => {
    newWindow = null;
  });
  newWindow.on("page-title-updated", function (e) {
    e.preventDefault();
  });
  return newWindow;
}

app.on("ready", createWindow);

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

/*
DISCORD STUFF
*/

const isMainInstance = app.requestSingleInstanceLock();

if (!isMainInstance) {
  app.quit();
} else {
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }

    createSecondaryWindow();
  });

  // Set this to your Client ID.
  const clientId = "733927271726841887";

  // Only needed if you want to use spectate, join, or ask to join
  DiscordRPC.register(clientId);

  const rpc = new DiscordRPC.Client({ transport: "ipc" });

  async function setActivity() {
    if (!rpc || !mainWindow) {
      return;
    }

    let discordData = {};

    try {
      discordData = await mainWindow.webContents.executeJavaScript(
        "DiscordRichPresence.getRichPresenceData()"
      );
    } catch (e) {
      console.warn("Something went wrong, could not gather discord RP data");
    }

    const activity = discordActivity(discordData);
    try {
      if (activity) await rpc.setActivity(activity);
      else await rpc.clearActivity();
    } catch (_) { console.warn('Discord activity unavailable.'); }
  }

  rpc.on("ready", () => {
    setActivity();

    // activity can only be set every 15 seconds
    setInterval(() => {
      setActivity();
    }, 15e3);
  });

  rpc.login({ clientId }).catch(console.error);

  /*
  UPDATE STUFF
  */
  const isNewerVersion = (version) => {
    return (
      version.localeCompare(currentVersion, undefined, { numeric: true }) === 1
    );
  };

  let downloading = false;
  const showProgress = async (initial, stage, data = {}) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const text = stage === 'download'
      ? `Downloading game files: ${(Number(data.received || 0) / 1048576).toFixed(2)} MB`
      : stage === 'validate' ? 'Validating game files...'
      : stage === 'install' ? 'Installing game files...' : 'Game files ready.';
    try {
      if (initial) await mainWindow.webContents.executeJavaScript(`window.setStatus?.(${JSON.stringify(text)})`);
      else await mainWindow.webContents.executeJavaScript(`(() => { const el = document.getElementById('update-message-progress'); if (el) el.textContent = ${JSON.stringify(text)}; })()`);
    } catch (_) { /* A closing or reloading window must not abort a safe update. */ }
  };
  const downloadUpdate = async (initial = false) => {
    if (downloading) return;
    downloading = true;
    let failure;
    try {
      if (!initial && mainWindow && !mainWindow.isDestroyed()) {
        const notice = {title:'Game update',message:'Downloading game files...<br/><span id="update-message-progress">Please wait...</span>',timeout:1e6};
        await mainWindow.webContents.executeJavaScript(`Notifier.notify(${JSON.stringify(notice)})`).catch(()=>{});
      }
      currentVersion = await installGameUpdate({dataDir,onProgress:(stage,data)=>showProgress(initial,stage,data)});
      protectGameIndex(path.join(dataDir,'pokeclicker-master/docs/index.html'), dataDir);
      startUpdateCheckInterval();
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (initial || dialog.showMessageBoxSync(mainWindow, {
        title:'Pokéclicker - Update ready',message:'The validated game update is ready. Reload now?',
        buttons:['Reload','Later'],defaultId:0,cancelId:1,noLink:true,
      }) === 0) await mainWindow.loadFile(path.join(dataDir,'pokeclicker-master/docs/index.html'));
    } catch (error) {
      failure = error;
      console.warn('Game update failed:',error.message);
    } finally { downloading = false; }
    if (failure && !windowClosed && mainWindow && !mainWindow.isDestroyed()) {
      const retry = dialog.showMessageBoxSync(mainWindow, {
        type:'error',title:'Pokéclicker - Update failed',
        message:'The game update could not finish. No save data was changed. The previous game is kept or retained as a recovery backup. Retry?',
        buttons:['Retry','Cancel'],defaultId:1,cancelId:1,noLink:true,
      });
      if (retry === 0) void downloadUpdate(initial);
    }
  };
  const checkForUpdates = async () => {
    try {
      const version = await fetchGameVersion();
      if (!mainWindow || mainWindow.isDestroyed()) return;
      newVersion = version;
      if (isNewerVersion(version)) {
        clearInterval(checkForUpdatesInterval);
        shouldUpdateNowCheck();
      }
    } catch (_) { console.warn('Game update check unavailable. Keeping cached game.'); }
  };

  const shouldUpdateNowCheck = () => {
    const userResponse = dialog.showMessageBoxSync(mainWindow, {
      title: "PokeClicker - Update available!",
      message: `There is a new update available (v${newVersion}),\nWould you like to download it now?\n\n`,
      icon: `${__dirname}/icon.png`,
      buttons: ["Update Now", "Remind Me", "No (disable check)"],
      noLink: true,
    });

    switch (userResponse) {
      case 0:
        downloadUpdate();
        break;
      case 1:
        // Check again in 1 hour
        setTimeout(shouldUpdateNowCheck, 36e5);
        break;
      case 2:
        console.info("Update check disabled, stop checking for updates");
        break;
    }
  };

  const startUpdateCheckInterval = (run_now = false) => {
    // Check for updates every hour
    clearInterval(checkForUpdatesInterval);
    checkForUpdatesInterval = setInterval(checkForUpdates, 36e5);
    if (run_now) checkForUpdates();
  };

  try {
    // If we can get our current version, start checking for updates once the game starts
    currentVersion = JSON.parse(
      fs
        .readFileSync(`${dataDir}/pokeclicker-master/docs/package.json`)
        .toString()
    ).version;
    if (currentVersion == "0.0.0")
      throw Error("Must re-download updated version");
    setTimeout(() => {
      startUpdateCheckInterval(true);
    }, 1e4);
  } catch (e) {
    // Game not downloaded yet
    downloadUpdate(true);
    console.log("downloading...");
  }

  // The archive replaces package.json, making automatic client version checks
  // unreliable. Client updates must be installed from the official release page.

}


/* Scripts and settings are scoped to each document in each game window. */
function injectDesktopScriptsModifications(gameWindow) {
  const indexFiles = [path.join(dataDir,'pokeclicker-master/docs/index.html'),path.join(__dirname,'pokeclicker-master/docs/index.html')];
  protectWindow(gameWindow,{indexFiles,openExternal:url=>shell.openExternal(url)});
  protectSession(gameWindow.webContents.session,indexFiles.map(file=>path.dirname(file)));
  attachScriptsWindow(gameWindow, {
    dataDir,
    bundledDir: path.join(__dirname, '../bundled-scripts'),
    version: POKECLICKER_SCRIPTS_DESKTOP_VERSION,
    electronVersion: process.versions.electron,
    packageVersion: modifiedPackageVersion,
  });
  rememberDownloads(gameWindow.webContents.session, config, saveSettings);
  gameWindow.on('resize', () => {
    const [width, height] = gameWindow.getSize();
    config.Sizing = {Width:width, Height:height, Maximized:gameWindow.isMaximized()};
    saveSettings();
  });
  if (config.Sizing.Maximized) gameWindow.maximize();
}
