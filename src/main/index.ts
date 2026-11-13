import { app } from 'electron';
import { migrateLegacyDirs } from '../core/paths';
import { AppController } from './controller';
import { registerImageScheme, serveImages } from './images';
import { ensureX11OnWayland } from './platform';

if (!ensureX11OnWayland()) {
  migrateLegacyDirs();
  if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    // The overlay and tray keep the app alive; closing the settings window must not quit.
    app.on('window-all-closed', () => {});
    registerImageScheme();
    void app.whenReady().then(() => {
      serveImages();
      const controller = new AppController();
      controller.start();
      app.on('second-instance', () => controller.showAll());
    });
  }
}
