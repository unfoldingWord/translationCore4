// #520: what "About translationCore" shows. Both values are part of the bundle,
// so the dialog opens with no request and with no network connection.
import LICENSE from '../../LICENSE?raw';

// The `version` of package.json, set by `define` in vite.config.js.
declare const __APP_VERSION__: string;

export const APP_VERSION: string = __APP_VERSION__;
/** The text of the repository's LICENSE file, as it is. */
export const LICENSE_TEXT: string = LICENSE;
