// ==UserScript==
// @name          [Pokeclicker] Script Fixer Upper
// @namespace     Pokeclicker Scripts
// @author        Ephenia
// @description   Resets known first-party script preferences while preserving saves, other app data, script enablement and update choices.
// @copyright     https://github.com/Ephenia
// @license       GPL-3.0 License
// @version       2.2.5

// @homepageURL   https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/
// @supportURL    https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/issues
// @downloadURL   https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/scriptfixerupper.user.js
// @updateURL     https://raw.githubusercontent.com/Axxxxpirine/Pokeclicker-Scripts-NEW/master/scriptfixerupper.user.js

// @match         https://www.pokeclicker.com/
// @icon          https://www.google.com/s2/favicons?domain=pokeclicker.com
// @grant         unsafeWindow
// @run-at        document-idle
// ==/UserScript==
// Modified by Axxxxpirine, 2026-10-27: fork maintenance and installation/update URLs.
// Includes this fork's compatibility and feature changes where applicable.
// Original authorship and GPL-3.0 licensing are retained.
// Security update, 2026-10-27: reset only known preferences, preserving execution consent and unrelated storage.

function initFixerUpper(resolve) {
    function resetScriptSettings() {
        setTimeout(() => {
            // Explicit first-party preference keys only. Never derive keys from game
            // metadata or delete broad prefixes: the origin also stores game saves,
            // other plugins, backups and desktop execution/update consent.
            const preferenceKeys = [
                'AVSautoClickerIntegration', 'AVSgraphicsDisabledSettings',
                'battleFrontCeil', 'battleFrontAttackCeil', 'autoBattleItems', 'toggleABItems',
                'autoNavigationSettings',
                'autoClickState', 'autoClickMultiplier', 'autoGymState', 'autoGymSelect',
                'autoDungeonState', 'autoDungeonFinishBeforeStopping', 'autoDungeonEncounterMode',
                'autoDungeonChestMode', 'autoDungeonLootTier', 'autoDungeonAlwaysOpenRareChests',
                'autoClickCalcEfficiencyDisplayMode', 'autoClickCalcDamageDisplayMode',
                'autoHatchState', 'autoEgg', 'autoFossil', 'shinyFossil', 'pokerusModeState',
                'filterOnly', 'priorityMonIds', 'autoHatchQueue', 'autoHatchQueueLimit',
                'autoHatchTypeSort', 'autoHatchTargetType1', 'autoHatchTargetType2',
                'autoMineState', 'autoMineBattery', 'autoMineSellReserves', 'autoSellTreasure',
                'filterState', 'filterShowPokerus', 'filterTypes', 'catchFilter', 'filterBallPref',
                'autoPlantState', 'autoHarvestState', 'autoReplantState', 'autoMulchState',
                'autoCatchState', 'autoPlantSelected', 'autoFarmPlanState', 'autoFarmRichState',
                'autoFarmMutationPlan', 'autoFarmPlanReserve', 'autoFarmRichReserve',
                'autoFarmRichCap', 'autoFarmRichSeconds', 'autoFarmStopAt', 'autoFarmTimerMinutes',
                'autoQuestEnabled', 'autoQuestMaxQuests', 'autoQuestIgnoredQuestTypes',
                'autoQuestResetTimer', 'autoQuestResetState', 'autoQuestRefreshBudget', 'autoQuestMoneyReserve',
                'autoSafariState', 'autoSafariPickItemsState', 'autoSafariThrowBaitsState',
                'autoSafariSeekUncaught', 'autoSafariSeekContagious', 'autoSafariFastAnimationsState',
                'ballAdjuster', 'omegaProteinCap', 'overnightGrowthMode', 'weatherChangerWeather',
                'globalShinyState', 'globalShinyRate', 'shinySetRates', 'shinyKarmaMode',
                'shinyKarmaRates', 'shinyDOMUpdate',
                'Flying Pikachu', 'Mewtwo strikes back!', 'Halloween!', "Let's GO!",
                'Merry Christmas!', 'Hoopa Day', 'Lunar New Year', 'Easter', 'Golden Week',
                "A Pirate's Life", "Ephenia's Gift",
            ];
            for (const key of preferenceKeys) {
                localStorage.removeItem(key);
            }
            if (App.isUsingClient) {
                // The repair tool is one-shot. Leave every other script's consent intact.
                localStorage.setItem('scriptfixerupper', false);
                localStorage.setItem('desktopEpheniaScript:scriptfixerupper', false);
            } else {
                localStorage.setItem('scriptfixerupper_browsernotification', true);
            }
            location.reload(); 
        }, 1000);
    }
    const warning = "Script Fixer Upper:\n\nReset known first-party script preferences? Saves, other app data, preference backups, script enablement and update choices are preserved. Unknown or third-party preferences are not reset. You should back up your saves before proceeding. Press OK to reset.\n\nThe page will reload when complete.";
    if (confirm(warning)) {
        resetScriptSettings();
    } else {
        resolve();
    }
}

function isFixerUpperEnabled() {
    try {
        const enabled = JSON.parse(localStorage.getItem('desktopEpheniaScript:scriptfixerupper'));
        if (typeof enabled === 'boolean') return enabled;
    } catch (_) { /* Older clients can still use their legacy consent key. */ }
    return localStorage.getItem('scriptfixerupper') === 'true';
}

if (localStorage.getItem('scriptfixerupper_browsernotification') === 'true') {
    // Special in-browser behavior after resets
    localStorage.removeItem('scriptfixerupper_browsernotification');
    alert('Script Fixer Upper:\n\nKnown first-party script preferences have been reset. Disable this script and reload the game.');
} else if (!App.isUsingClient || isFixerUpperEnabled()) {
    // Load fixer upper
    const fixerUpperDone = new Promise((resolve, reject) => {
        setTimeout(() => {
            initFixerUpper(resolve);
        }, 1000);
    });
    // Won't load game until fixer upper is cancelled
    const loadApp = Preload.load.bind(Preload);
    Preload.load = function load(...args) {
        return fixerUpperDone.finally(() => loadApp(...args));
    }
}
