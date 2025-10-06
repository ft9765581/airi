import { dirname, join } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'

import { is } from '@electron-toolkit/utils'
import { BrowserWindow, shell } from 'electron'
import { isMacOS } from 'std-env'

import icon from '../../../../resources/icon.png?asset'

import { transparentWindowConfig } from '../shared'
import { setupAppInvokeHandlers } from './eventa/index.electron'
import { setupWebInvokes } from './eventa/index.web'

export function setup() {
  const window = new BrowserWindow({
    title: 'AIRI',
    width: 450.0,
    height: 600.0,
    show: false,
    icon,
    webPreferences: {
      preload: join(dirname(fileURLToPath(import.meta.url)), '../preload/index.mjs'),
      sandbox: false,
    },
    ...transparentWindowConfig(),
  })

  window.setAlwaysOnTop(true)
  if (isMacOS) {
    window.setWindowButtonVisibility(false)
  }

  window.on('ready-to-show', () => window!.show())
  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && env.ELECTRON_RENDERER_URL) {
    window.loadURL(env.ELECTRON_RENDERER_URL)
  }
  else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  setupAppInvokeHandlers(window)
  setupWebInvokes(window)

  return window
}
