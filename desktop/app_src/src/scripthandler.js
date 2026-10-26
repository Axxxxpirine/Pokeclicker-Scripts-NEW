class DesktopScriptHandler {
    static hasRegisteredUserScript = false;
    
    static getScriptEnabled(name, defaultVal = false) {
        var val = localStorage.getItem(name);
        try { val = JSON.parse(val); } catch (_) { val = null; }
        if (typeof val === 'boolean') {
            return val;
        }
        return defaultVal;
    }

    static isEpheniaScriptEnabled(name) {
        const key = 'desktopEpheniaScript:' + name;
        if (localStorage.getItem(key) === null) {
            // Legacy keys share storage with game saves. Read booleans only,
            // and never repair or overwrite a value in that shared namespace.
            localStorage.setItem(key, this.getScriptEnabled(name, false));
        }
        return this.getScriptEnabled(key, false);
    }

    static isUserScriptEnabled(name) {
        const key = 'desktopUserScript:' + name;
        if (localStorage.getItem(key) === null) {
            // Migrate the historical first-dot key, including an explicit OFF.
            const legacy = this.getScriptEnabled(name.split('.')[0], true);
            localStorage.setItem(key, legacy);
        }
        return this.getScriptEnabled(key, true);
    }

    static registerEpheniaScript(name) {
        const enabled = this.isEpheniaScriptEnabled(name);

        if (name == 'scriptfixerupper') {
            // Display scriptfixerupper separately from the normal scripts
            const settingContainer = 'settings-scripts-desktopSettings';
            const customText = 'Enable scriptfixerupper (reset script settings)';
            this.addScriptEnabledSetting(name, settingContainer, enabled, customText, false, 'desktopEpheniaScript:' + name);
        } else {
            const settingContainer = 'settings-scripts-enableScriptsEphenia';
            this.addScriptEnabledSetting(name, settingContainer, enabled, null, true, 'desktopEpheniaScript:' + name);
        }
    }

    static registerUserScript(name) {
        const settingContainer = 'settings-scripts-enableScriptsUser';
        const enabled = this.isUserScriptEnabled(name);

        // Remove no scripts installed message
        if (!this.hasRegisteredUserScript) {
            document.getElementById('settings-scripts-enableScriptsUser').innerHTML = '';
            this.hasRegisteredUserScript = true;
        }

        this.addScriptEnabledSetting('desktopUserScript:' + name, settingContainer, enabled, `Enable ${name}`);
    }

    static addScriptEnabledSetting(name, container, enabled, customText = null, alphabetical = true, storageKey = name) {
        if (document.getElementById('checkbox-' + name)) return;
        var setting = document.createElement('tr')
        const labelCell = document.createElement('td');
        labelCell.className = 'p-2 col-md-8';
        const label = document.createElement('label');
        label.className = 'm-0';
        label.htmlFor = 'checkbox-' + name;
        label.textContent = customText || `Enable ${name}`;
        labelCell.appendChild(label);
        const inputCell = document.createElement('td');
        inputCell.className = 'p-2 col-md-4';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = 'checkbox-' + name;
        inputCell.appendChild(input);
        setting.append(labelCell, inputCell);

        container = document.getElementById(container);
        // Insert setting in alphabetical order
        if (alphabetical) {
            let settingsList = Array.from(container.children);
            let insertBefore = settingsList.find(elem => elem.querySelector('input').id > 'checkbox-' + name);
            if (insertBefore) {
                insertBefore.before(setting);
            } else {
                container.appendChild(setting);
            }
        } else {
            container.appendChild(setting);
        }

        document.getElementById('checkbox-'+ name).checked = enabled;
        document.getElementById('checkbox-'+ name).addEventListener('change', event => {
            localStorage.setItem(storageKey, event.target.checked);
        });
    }

    // Should only be called by main.js once per game launch!
    static shouldScriptsAutoUpdate() {
        var returnval = this.scriptAutoUpdatesEnabled() || this.updateScriptsNextLaunch();
        // The main process clears this only after a successful update check.
        return returnval;
    }

    static scriptAutoUpdatesEnabled() {
        var val = localStorage.getItem('epheniaScriptAutoUpdates');
        try { val = JSON.parse(val); } catch (_) { val = null; }
        return val !== false;
    }

    static updateScriptsNextLaunch() {
        var val = localStorage.getItem('epheniaUpdateScriptsNextLaunch');
        try { val = JSON.parse(val); } catch (_) { val = null; }
        return val === true;
    }

    static showStatus() {
        let row = document.getElementById('desktop-script-status');
        if (!row) {
            row = document.createElement('tr');
            row.id = 'desktop-script-status';
            row.appendChild(document.createElement('td'));
            row.firstChild.colSpan = 2;
            document.getElementById('settings-scripts-desktopSettings').prepend(row);
        }
        const versions = window.desktopScriptsVersions || {};
        const state = window.desktopScriptsStatus || {};
        row.firstChild.style.whiteSpace = 'pre-line';
        row.firstChild.textContent = `Scripts Desktop: ${versions.scripts || '?'} | Game: ${typeof App !== 'undefined' ? App.game?.update?.version || '?' : '?'}
Client installed: ${versions.client || 'unknown'} | Modified package: ${versions.package || '?'} | Electron: ${versions.electron || '?'}
${state.offline ? 'Offline: using cached scripts' : `Updates: ${state.updated || 0} installed, ${state.available || 0} available, ${state.failed || 0} failed`}
${state.desktopUpdateAvailable ? 'Desktop scripts update available: ' + state.latestDesktopVersion + ' (see the fork desktop page)' : ''}
${state.errors?.length ? 'Scripts with errors: ' + state.errors.join(', ') : 'Script loading finished'}`;
        if (state.desktopUpdateAvailable) {
            const link = document.createElement('a');
            link.href = 'https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/tree/master/desktop';
            link.target = '_blank';
            link.rel = 'noopener';
            link.textContent = ' Desktop update instructions';
            row.firstChild.appendChild(link);
        }
    }

    static init() {
        if (document.getElementById('settings-scripts-desktopSettings')) return;
        console.log('Loading Pokéclicker Scripts Desktop scripthandler');

        // Fixes the Scripts nav item getting wrapped to the bottom by increasing the max width of the window
        document.getElementById('settingsModal').querySelector('div').style.maxWidth = '850px';

        // Select the top header row of tabs in Settings
        const settingTabs = document.querySelector('#settingsModal ul.nav-tabs');

        let li = document.createElement('li');
        li.classList.add('nav-item');
        li.innerHTML = `<a class="nav-link" href="#settings-scripts" data-toggle="tab">Scripts</a>`;
        settingTabs.appendChild(li);

        // Select the parent element that contains the content of the tabs
        const tabContent = document.querySelector('#settingsModal .tab-content');

        // Create and append the content for the script tab to Settings
        const scriptSettings = document.createElement('div');
        scriptSettings.classList.add('tab-pane');
        scriptSettings.setAttribute('id', 'settings-scripts');
        tabContent.appendChild(scriptSettings);

        let settingsContainer = document.createElement('div');
        settingsContainer.setAttribute('id', 'settings-scripts-container');
        scriptSettings.appendChild(settingsContainer);

        let table = document.createElement('table');
        table.classList.add('table', 'table-striped', 'table-hover', 'm-0');
        scriptSettings.appendChild(table);

        let tableSections = [['desktopSettings', 'Pokéclicker Scripts desktop settings'],
            ['enableScriptsEphenia', 'Downloaded scripts'],
            ['enableScriptsUser', 'User-added scripts']];
        tableSections.forEach(([id, desc]) => {
            let elem = document.createElement('thead');
            elem.innerHTML = `<tr><th colspan="2">${desc}</th></tr>`;
            table.appendChild(elem);

            elem = document.createElement('tbody');
            elem.setAttribute('id', 'settings-scripts-' + id);
            table.appendChild(elem);
        });

        if (window.jQuery) window.jQuery('#settingsModal').on('show.bs.modal', () => this.showStatus());

        // Add info about restarting to the top
        let info = document.createElement('tr');
        info.innerHTML = `<td class="p-2" colspan="2"><label class="m-0">Settings changes will take effect on restart</label></td>`;
        document.getElementById('settings-scripts-desktopSettings').appendChild(info);

        // Add temporary no-user-added-scripts text
        info = document.createElement('tr');
        info.innerHTML = `<td class="p-2" colspan="2"><label class="m-0">No scripts installed</label></td>`;
        document.getElementById('settings-scripts-enableScriptsUser').appendChild(info);


        // Add setting to disable script auto-updates
        let setting = document.createElement('tr')
        setting.innerHTML =
            `<td class="p-2 col-md-8"><label class="m-0" for="checkbox-scriptAutoUpdates">Script auto-updates enabled</label></td>` + 
            `<td class="p-2 col-md-4"><input id="checkbox-scriptAutoUpdates" type="checkbox"></td>`;
        document.getElementById('settings-scripts-desktopSettings').appendChild(setting);
        document.getElementById('checkbox-scriptAutoUpdates').checked = this.scriptAutoUpdatesEnabled();
        document.getElementById('checkbox-scriptAutoUpdates').addEventListener('change', event => {
            localStorage.setItem('epheniaScriptAutoUpdates', event.target.checked);
        });
        // Add auto-updated-disabled-specific setting to update next launch
        if (!this.scriptAutoUpdatesEnabled()) {
            setting = document.createElement('tr');
            setting.innerHTML =
                `<td class="p-2 col-md-8"><label class="m-0" for="checkbox-updateScriptsNextLaunch">Update scripts on next game launch</label></td>` + 
                `<td class="p-2 col-md-4"><input id="checkbox-updateScriptsNextLaunch" type="checkbox"></td>`;
            document.getElementById('settings-scripts-desktopSettings').appendChild(setting);
            document.getElementById('checkbox-updateScriptsNextLaunch').addEventListener('change', event => {
                localStorage.setItem('epheniaUpdateScriptsNextLaunch', event.target.checked);
            });
        }

    }
}

DesktopScriptHandler.init();
