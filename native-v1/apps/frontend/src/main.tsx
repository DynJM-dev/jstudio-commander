// N1 Task 2 scaffold. Real React mount + App tree lands in Task 8.
// Critical ban preserved: no React.StrictMode wrapper (OS §15).

import { createRoot } from 'react-dom/client';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');

createRoot(root).render(<div>jstudio-commander frontend — Task 2 scaffold.</div>);
