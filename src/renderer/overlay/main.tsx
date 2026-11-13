import { createRoot } from 'react-dom/client';
import { OverlayApp } from './OverlayApp';
import './overlay.css';
import './panelSize';

createRoot(document.getElementById('root')!).render(<OverlayApp />);
