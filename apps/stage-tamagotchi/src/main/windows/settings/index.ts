import { dirname, join } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'

import { is } from '@electron-toolkit/utils'
import { BrowserWindow, shell } from 'electron'

import icon from '../../../../resources/icon.png?asset'

import { setupWebInvokes } from './rpc/index.web'

export async function setupSettingsWindow() {
  const window = new BrowserWindow({
    title: 'AIRI',
    width: 600.0,
    height: 800.0,
    show: false,
    icon,
    webPreferences: {
      preload: join(dirname(fileURLToPath(import.meta.url)), '../preload/index.mjs'),
      sandbox: false,
    },
  })

  window.on('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && env.ELECTRON_RENDERER_URL) {
    await window.loadURL(`${env.ELECTRON_RENDERER_URL}/#/settings`)
  }
  else {
    await window.loadFile(join(__dirname, '../renderer/index.html/#/settings'))
  }

  // Setup
  setupWebInvokes(window)

  return window
}
