// No React.StrictMode — see OS §15 critical bans (Supabase navigator.locks
// deadlock, useEffect double-fire). Even though Commander v1 doesn't use
// Supabase, the double-effect semantics also breaks the xterm.js addon-webgl
// lifecycle (double mount → second canvas context steals rendering).

import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');

createRoot(root).render(<App />);
