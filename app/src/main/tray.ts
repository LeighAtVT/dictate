// Dictate v2, Task 11: the menu-bar item, the Electron half of v1's `StatusItemController`
// (Sources/DictateApp/StatusItemController.swift). The menu is rebuilt from trayModel.ts each time
// it opens, as v1's `menuNeedsUpdate` does, so it always shows the current history and status.
import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { trayMenu, type TrayAction, type TrayIcon, type TrayItem, type TrayState } from './trayModel'

export type TrayHandlers = Record<TrayAction, (payload?: string) => void>

export class TrayController {
  private readonly tray: Tray
  private readonly iconDir: string
  private icon: TrayIcon | null = null

  constructor(iconDir: string, tooltip: string, state: () => TrayState, handlers: TrayHandlers) {
    this.iconDir = iconDir
    this.tray = new Tray(this.image('idle'))
    this.icon = 'idle'
    this.tray.setToolTip(tooltip)
    const open = (): void => this.tray.popUpContextMenu(Menu.buildFromTemplate(toTemplate(trayMenu(state()), handlers)))
    this.tray.on('click', open)
    this.tray.on('right-click', open)
  }

  set(icon: TrayIcon): void {
    if (icon === this.icon) return
    this.icon = icon
    this.tray.setImage(this.image(icon))
  }

  private image(icon: TrayIcon): Electron.NativeImage {
    // `…Template.png` (+ `@2x`) is picked up as a template image, so macOS tints it for the menu bar.
    const image = nativeImage.createFromPath(join(this.iconDir, `${icon}Template.png`))
    image.setTemplateImage(true)
    return image
  }
}

function toTemplate(items: TrayItem[], handlers: TrayHandlers): MenuItemConstructorOptions[] {
  return items.map((item): MenuItemConstructorOptions => {
    switch (item.kind) {
      case 'separator':
        return { type: 'separator' }
      case 'status':
        return { label: item.label, enabled: false }
      case 'submenu':
        return { label: item.label, submenu: toTemplate(item.items, handlers) }
      case 'action':
        return {
          label: item.label,
          enabled: item.enabled,
          accelerator: item.accelerator,
          registerAccelerator: false,
          click: () => handlers[item.action](item.payload)
        }
    }
  })
}
