// Dictate v2, Task 11: the pill window's preload (main/pill.ts). It exposes one thing, the text to
// show, and nothing else: the pill runs sandboxed and needs no other access.
import { contextBridge, ipcRenderer } from 'electron'

export interface PillMessage {
  text: string
  listening: boolean
}

contextBridge.exposeInMainWorld('pill', {
  onUpdate(callback: (message: PillMessage) => void): void {
    ipcRenderer.on('pill', (_event, message: PillMessage) => callback(message))
  }
})
