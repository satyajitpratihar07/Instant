import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { preventClickjacking } from './security';

// Security: Prevent the app from being embedded in iframes (clickjacking defense)
preventClickjacking();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
