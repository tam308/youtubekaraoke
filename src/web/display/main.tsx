import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { KaraokeProvider } from '../shared-ui/KaraokeContext';
import { DisplayApp } from './App';
import '../shared-ui/theme.css';
import './display.css';

// The launch token arrives in the URL fragment (never sent to any server in a request line).
const token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <KaraokeProvider auth={{ token }}>
      <DisplayApp />
    </KaraokeProvider>
  </StrictMode>,
);
