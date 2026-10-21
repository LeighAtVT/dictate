// Dictate v2, Task 12: the Settings and Onboarding windows' preload. It exposes `window.dictate`
// (shared/dictate.ts) and nothing else. Both windows run sandboxed, so this may only require
// 'electron'; the channel names are bundled in from shared/dictate.ts. main/ipc.ts validates
// every argument passed through here.
import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, SETTINGS_CHANGED, type DictateApi, type Settings } from '../shared/dictate'

const api: DictateApi = {
  getSettings: () => ipcRenderer.invoke(CHANNELS.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(CHANNELS.setSettings, patch),
  onSettings(callback) {
    const listener = (_event: unknown, settings: Settings): void => callback(settings)
    ipcRenderer.on(SETTINGS_CHANGED, listener)
    return () => {
      ipcRenderer.removeListener(SETTINGS_CHANGED, listener)
    }
  },
  saveKey: (key) => ipcRenderer.invoke(CHANNELS.saveKey, key),
  hasKey: () => ipcRenderer.invoke(CHANNELS.hasKey),
  testModel: (choice, key) =>
    key === undefined ? ipcRenderer.invoke(CHANNELS.testModel, choice) : ipcRenderer.invoke(CHANNELS.testModel, choice, key),
  vocabulary: {
    get: () => ipcRenderer.invoke(CHANNELS.getVocabulary),
    set: (terms) => ipcRenderer.invoke(CHANNELS.setVocabulary, terms)
  },
  shortcuts: {
    get: () => ipcRenderer.invoke(CHANNELS.getShortcuts),
    set: (list) => ipcRenderer.invoke(CHANNELS.setShortcuts, list)
  },
  knownApps: () => ipcRenderer.invoke(CHANNELS.knownApps),
  permissions: () => ipcRenderer.invoke(CHANNELS.permissions),
  requestPermission: (name) => ipcRenderer.invoke(CHANNELS.requestPermission, name),
  clearHistory: () => ipcRenderer.invoke(CHANNELS.clearHistory),
  openKeyboardSettings: () => ipcRenderer.invoke(CHANNELS.openKeyboardSettings)
}

contextBridge.exposeInMainWorld('dictate', api)
