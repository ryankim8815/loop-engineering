// Browser entry point (loaded by index.html). The only module with side effects:
// it wires the real `document` and `fetch` into the app controller.

import { createApi } from './api.js';
import { startApp } from './app.js';

startApp({ document, window, api: createApi(fetch) });
