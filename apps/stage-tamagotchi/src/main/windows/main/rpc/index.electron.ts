import type { BrowserWindow } from 'electron'

import { defineInvokeHandler } from '@unbird/eventa'
import { createContext } from '@unbird/eventa/adapters/electron/main'
import { ipcMain } from 'electron'

import { electronOpenMainDevtools, electronOpenSettings } from '../../../../shared/eventa'
import { createScreenService } from '../../../services/electron'
import { createFadeOnHoverService } from '../../../services/fade-on-hover'
import { createMouseService } from '../../../services/misc/mouse'
import { toggleWindowShow } from '../../shared'

export function setupMainWindowElectronInvokes(params: { window: BrowserWindow, settingsWindow: () => Promise<BrowserWindow> }) {
  const { context } = createContext(ipcMain, params.window)

  createFadeOnHoverService(context)
  createMouseService(context)
  createScreenService({ context, window: params.window })

  defineInvokeHandler(context, electronOpenMainDevtools, () => params.window.webContents.openDevTools({ mode: 'detach' }))
  defineInvokeHandler(context, electronOpenSettings, async () => toggleWindowShow(await params.settingsWindow()))
}
