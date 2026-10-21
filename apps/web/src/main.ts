// SPDX-License-Identifier: GPL-3.0-or-later
// Entry point of the SLATE web UI.

import '@fontsource/b612/400.css';
import '@fontsource/b612/700.css';
import '@fontsource/b612-mono/400.css';
import '@fontsource/b612-mono/700.css';
import './app.css';

import { mount } from 'svelte';

import { host } from './lib/host.svelte.js';
import App from './shell/App.svelte';

const target = document.getElementById('app');
if (target === null) throw new Error('Missing #app element');

host.start();
mount(App, { target });
