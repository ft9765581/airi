import type http from 'node:http'

import type { BrowserWindow } from 'electron'
import type { Listener } from 'listhen'

import { platform } from 'node:process'

import { electronApp, optimizer } from '@electron-toolkit/utils'
import { Format, LogLevel, setGlobalFormat, setGlobalLogLevel } from '@guiiai/logg'
import { app, Menu, nativeImage, Tray } from 'electron'
import { isMacOS } from 'std-env'

import icon from '../../resources/icon.png?asset'
import macOSTrayIcon from '../../resources/tray-icon-macos.png?asset'

import { openDebugger, setupDebugger } from './app/debugger'
import { emitAppBeforeQuit, emitAppReady, emitAppWindowAllClosed } from './libs/bootkit/lifecycle'
import { setup } from './windows/main'
import { useWebInvokes } from './windows/main/eventa/index.web'
import { toggleWindowShow } from './windows/shared/window'

setGlobalFormat(Format.Pretty)
setGlobalLogLevel(LogLevel.Log)
setupDebugger()

app.dock?.setIcon(icon)
electronApp.setAppUserModelId('ai.moeru.airi')

let serverInstance: Listener | null = null
let mainWindow: BrowserWindow | null = null
let appTray: Tray | null = null

function createTray(): void {
  if (appTray) {
    return
  }

  appTray = new Tray(nativeImage.createFromPath(macOSTrayIcon).resize({ width: 16 }))

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Window', click: () => toggleWindowShow(mainWindow) },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        toggleWindowShow(mainWindow)
        const web = useWebInvokes()
        web.openSettings()
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ])

  appTray.setContextMenu(contextMenu)
  appTray.setToolTip('Project AIRI')
  appTray.addListener('click', () => toggleWindowShow(mainWindow))
  // On macOS, there's a special double-click event
  if (isMacOS) {
    appTray.addListener('double-click', () => toggleWindowShow(mainWindow))
  }
}

app.whenReady().then(async () => {
  // Start the server-runtime server with WebSocket support
  try {
    // Dynamically import the server-runtime and listhen
    const [serverRuntimeModule, { listen }] = await Promise.all([
      import('@proj-airi/server-runtime'),
      import('listhen'),
    ])

    // The server-runtime exports the h3 app as a named export
    const serverRuntimeApp = serverRuntimeModule.app

    serverInstance = await listen(serverRuntimeApp as unknown as http.RequestListener, {
      port: 6121,
      hostname: 'localhost',
      // Enable WebSocket support as used in the server-runtime package
      ws: true,
    })

    console.info('WebSocket server started on ws://localhost:6121')
  }
  catch (error) {
    console.error('Failed to start WebSocket server:', error)
  }

  mainWindow = setup()
  createTray()

  // Lifecycle
  emitAppReady()

  // Extra
  openDebugger()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
}).catch((err) => {
  console.error('Error during app initialization:', err)
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  emitAppWindowAllClosed()

  if (platform !== 'darwin') {
    app.quit()
  }
})

// Clean up server and intervals when app quits
app.on('before-quit', async () => {
  emitAppBeforeQuit()

  // Close the server if it's running
  if (serverInstance && typeof serverInstance.close === 'function') {
    try {
      await serverInstance.close()
      console.info('WebSocket server closed')
    }
    catch (error) {
      console.error('Error closing WebSocket server:', error)
    }
  }

  if (appTray) {
    appTray.destroy()
    appTray = null
  }
})
