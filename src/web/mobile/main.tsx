import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MobileApp } from './App';
import '../shared-ui/theme.css';
import './mobile.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MobileApp />
  </StrictMode>,
);
