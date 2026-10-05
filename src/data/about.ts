// #520: what "About translationCore" and its "License" dialog show. The build
// reads every value, so the dialogs open with no request and with no network
// connection, and no license text is typed into the code.
import LICENSE from '../../LICENSE?raw';
import COPYING from '../../COPYING?raw';

// The `version` of package.json and the short commit hash of the build, set by
// `define` in vite.config.js.
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;

export const APP_VERSION: string = __APP_VERSION__;
export const APP_COMMIT: string = __APP_COMMIT__;
/** The text of the repository's LICENSE file (the license notice), as it is. */
export const LICENSE_TEXT: string = LICENSE;
/** The copyright line: the first line of the LICENSE file. */
export const COPYRIGHT_LINE: string = LICENSE.split('\n', 1)[0].trim();
/** The full text of the GNU GPL version 2: the repository's COPYING file, as it is. */
export const GPL_TEXT: string = COPYING;
