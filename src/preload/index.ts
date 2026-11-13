import { contextBridge, ipcRenderer } from 'electron';
import type { AppViewModel, EveAssistantApi, PanelSize, SettingsNav } from './api';

const api: EveAssistantApi = {
  onState: (cb) => {
    const listener = (_e: unknown, vm: AppViewModel) => cb(vm);
    ipcRenderer.on('vm', listener);
    return () => ipcRenderer.removeListener('vm', listener);
  },
  onPanelSize: (cb) => {
    const listener = (_e: unknown, size: PanelSize) => cb(size);
    ipcRenderer.on('overlay:panel', listener);
    return () => ipcRenderer.removeListener('overlay:panel', listener);
  },
  onNavigate: (cb) => {
    const listener = (_e: unknown, nav: SettingsNav) => cb(nav);
    ipcRenderer.on('settings:navigate', listener);
    return () => ipcRenderer.removeListener('settings:navigate', listener);
  },
  getState: () => ipcRenderer.invoke('vm:get'),
  search: (q) => ipcRenderer.invoke('encounter:search', q),
  selectEncounter: (ref) => ipcRenderer.invoke('encounter:select', ref),
  setPocket: (i) => ipcRenderer.invoke('encounter:pocket', i),
  getSiteMap: () => ipcRenderer.invoke('sitemap:get'),
  getAbyss: () => ipcRenderer.invoke('abyss:get'),
  getAbyssLog: () => ipcRenderer.invoke('abyss:log'),
  saveAbyssLoot: (id, text, before) => ipcRenderer.invoke('abyss:loot', id, text, before),
  abyssCargo: (which) => ipcRenderer.invoke('abyss:cargo', which),
  uploadAbyssRun: (id) => ipcRenderer.invoke('abyss:upload', id),
  dismissAbyssLoot: (id) => ipcRenderer.invoke('abyss:lootDismiss', id),
  openAbyssLoot: (id) => ipcRenderer.send('abyss:lootOpen', id),
  ewbSetKey: (key) => ipcRenderer.invoke('ewb:setKey', key),
  ewbClearKey: () => ipcRenderer.invoke('ewb:clearKey'),
  ewbSync: () => ipcRenderer.invoke('ewb:sync'),
  setAbyssPreview: (on) => ipcRenderer.invoke('abyss:preview', on),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  intelTest: () => ipcRenderer.invoke('intel:test'),
  intelSetDestination: (systemId) => ipcRenderer.invoke('intel:destination', systemId),
  intelClear: (systemId) => ipcRenderer.invoke('intel:clear', systemId),
  setClickThrough: (on) => ipcRenderer.invoke('overlay:clickThrough', on),
  setSearchOpen: (open) => ipcRenderer.invoke('overlay:search', open),
  beginOverlayDrag: (kind) => ipcRenderer.send('overlay:dragStart', kind),
  dragOverlay: () => ipcRenderer.send('overlay:drag'),
  endOverlayDrag: (size) => ipcRenderer.send('overlay:dragEnd', size),
  pickLogDir: () => ipcRenderer.invoke('settings:pickLogDir'),
  saveFit: (eft) => ipcRenderer.invoke('fit:save', eft),
  selectFit: (id) => ipcRenderer.invoke('fit:select', id),
  removeFit: (id) => ipcRenderer.invoke('fit:remove', id),
  esiLogin: () => ipcRenderer.invoke('esi:login'),
  esiCancelLogin: () => ipcRenderer.invoke('esi:cancel'),
  esiLogout: (id) => ipcRenderer.invoke('esi:logout', id),
  esiSync: () => ipcRenderer.invoke('esi:sync'),
  changeLoadout: (id, change) => ipcRenderer.invoke('fit:loadout', id, change),
  updateSde: () => ipcRenderer.invoke('sde:update'),
  checkUpdates: () => ipcRenderer.invoke('updates:check'),
  checkAppUpdate: () => ipcRenderer.invoke('app-update:check'),
  installAppUpdate: () => ipcRenderer.invoke('app-update:install'),
  openSettings: () => ipcRenderer.send('window:settings'),
  setOverlayBelow: (rects) => ipcRenderer.send('overlay:below', rects),
  setOverlaySide: (rects) => ipcRenderer.send('overlay:side', rects),
  hideOverlay: () => ipcRenderer.send('overlay:hide'),
  setMinimized: (on) => ipcRenderer.send('overlay:minimize', on),
  openExternal: (url) => ipcRenderer.send('shell:open', url),
};

contextBridge.exposeInMainWorld('eve', api);
