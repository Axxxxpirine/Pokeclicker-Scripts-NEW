// This script has no effect outside the desktop app. It should not be manually installed.

{
	// IMPORTANT: Always keep this up to date with the version number in app_src/main.js
	const LATEST_VERSION = '2.2.2';

	if (App.isUsingClient) {
		if (typeof POKECLICKER_SCRIPTS_DESKTOP_VERSION !== 'string' 
			|| LATEST_VERSION.localeCompare(POKECLICKER_SCRIPTS_DESKTOP_VERSION, undefined, {numeric: true}) > 0) {
			Notifier.notify({
		      type: NotificationConstants.NotificationOption.info,
		      title: 'Pokéclicker Scripts Desktop update',
		      message: 'A new version of Pokéclicker Scripts Desktop is available for download:\n\n<a href="https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/tree/master/desktop" target="_blank">https://github.com/Axxxxpirine/Pokeclicker-Scripts-NEW/tree/master/desktop</a>',
		      timeout: GameConstants.DAY,
		    });
		}
	}
}