import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { applyInitialTheme } from './lib/theme.ts';
import { Prototype } from './prototype/Prototype.tsx';
import './styles.css';

applyInitialTheme();

const page = window.location.pathname.startsWith('/prototype') ? <Prototype /> : <App />;

createRoot(document.getElementById('root')!).render(<StrictMode>{page}</StrictMode>);
