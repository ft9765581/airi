import type { BrowserWindow, BrowserWindowConstructorOptions, Rectangle } from 'electron'

import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'

import { defineInvokeHandler } from '@unbird/eventa'
import { createContext } from '@unbird/eventa/adapters/electron/main'
import { animate, utils } from 'animejs'
import { BrowserWindow as ElectronBrowserWindow, ipcMain, screen, shell } from 'electron'
import { debounce, throttle } from 'es-toolkit'
import { isMacOS } from 'std-env'

import icon from '../../../../resources/icon.png?asset'

import { captionAttachedChanged, captionGetAttached } from '../../../shared/eventa'
import { baseUrl, getElectronMainDirname, load, withHashRoute } from '../../libs/electron/location'
import { createReusableWindow } from '../../libs/electron/window-manager'
import { mapForBreakpoints, resolutionBreakpoints, widthFrom } from '../shared/display'
import { createConfig } from '../shared/persistence'
import { transparentWindowConfig } from '../shared/window'

interface CaptionMatrixConfig {
  bounds: Rectangle
  relativeToMain?: { dx: number, dy: number }
}

interface CaptionConfig {
  attached: boolean
  matrices: Record<string, CaptionMatrixConfig>
}

function computeDisplayMatrixHash(): string {
  const displays = screen.getAllDisplays()
  const signature = displays
    .slice()
    .sort((a, b) => (a.bounds.x - b.bounds.x) || (a.bounds.y - b.bounds.y))
    .map(d => [d.bounds.x, d.bounds.y, d.bounds.width, d.bounds.height, d.scaleFactor ?? 1].join(','))
    .join('|')

  return createHash('sha256').update(signature).digest('hex').slice(0, 16)
}

function clampBoundsWithinRect(bounds: Rectangle, rect: Rectangle): Rectangle {
  const x = Math.min(Math.max(bounds.x, rect.x), rect.x + rect.width - bounds.width)
  const y = Math.min(Math.max(bounds.y, rect.y), rect.y + rect.height - bounds.height)
  return { x, y, width: bounds.width, height: bounds.height }
}

function computeInitialCaptionBounds(params: { mainWindow: BrowserWindow, captionOptions?: Partial<Rectangle> }): Rectangle {
  const mainBounds = params.mainWindow.getBounds()
  const displayWorkArea = screen.getDisplayMatching(mainBounds).workArea

  // Base sizing from display width with sensible caps
  const width = mapForBreakpoints(
    displayWorkArea.width,
    {
      '720p': widthFrom(displayWorkArea, { percentage: 0.9, max: { actual: 560 }, min: { actual: 280 } }),
      '1080p': widthFrom(displayWorkArea, { percentage: 0.5, max: { actual: 640 }, min: { actual: 320 } }),
      '2k': widthFrom(displayWorkArea, { percentage: 0.4, max: { actual: 720 }, min: { actual: 360 } }),
      '4k': widthFrom(displayWorkArea, { percentage: 0.33, max: { actual: 768 }, min: { actual: 420 } }),
    },
    { breakpoints: resolutionBreakpoints },
  )
  const height = Math.max(Math.floor(width / 3.2), 120)

  const margin = 16
  // Prefer to the right of main window, else to the left, else bottom centered
  let x = mainBounds.x + mainBounds.width + margin
  let y = mainBounds.y + mainBounds.height - height

  const rightEdge = x + width
  const displayRight = displayWorkArea.x + displayWorkArea.width

  if (rightEdge > displayRight) {
    // Place to the left
    x = mainBounds.x - width - margin
  }

  // If still out of bounds horizontally, fallback to bottom center
  if (x < displayWorkArea.x || (x + width) > displayRight) {
    x = displayWorkArea.x + Math.floor((displayWorkArea.width - width) / 2)
  }

  // Clamp vertically
  if (y < displayWorkArea.y) {
    y = displayWorkArea.y + margin
  }

  const initial = clampBoundsWithinRect({ x, y, width, height }, displayWorkArea)

  return { ...initial, ...params.captionOptions }
}

function createCaptionWindow(options?: BrowserWindowConstructorOptions) {
  const window = new ElectronBrowserWindow({
    title: 'Caption',
    width: 480,
    height: 180,
    show: false,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
    },
    // Thanks to [@HeartArmy](https://github.com/HeartArmy) for the tip implementation.
    //
    // https://github.com/electron/electron/issues/10078#issuecomment-3410164802
    // https://stackoverflow.com/questions/39835282/set-browserwindow-always-on-top-even-other-app-is-in-fullscreen-electron-mac
    type: 'panel',
    ...transparentWindowConfig(),
    ...options,
  })

  // Click-through is controlled by caller via setIgnoreMouseEvents
  // Avoid window buttons on macOS frameless windows
  // Thanks to [@HeartArmy](https://github.com/HeartArmy) for the tip implementation.
  //
  // https://github.com/electron/electron/issues/10078#issuecomment-3410164802
  // https://stackoverflow.com/questions/39835282/set-browserwindow-always-on-top-even-other-app-is-in-fullscreen-electron-mac
  window.setAlwaysOnTop(true, 'screen-saver', 2)
  window.setFullScreenable(false)
  window.setVisibleOnAllWorkspaces(true)
  if (isMacOS) {
    window.setWindowButtonVisibility(false)
  }

  window.on('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  return window
}

export function setupCaptionWindowManager(params: { mainWindow: BrowserWindow }) {
  const matrixHash = computeDisplayMatrixHash()

  const {
    setup: setupConfig,
    get: getConfig,
    update: updateConfig,
  } = createConfig<CaptionConfig>('windows-caption', 'config.json', { default: { attached: true, matrices: {} } })

  setupConfig()

  let isAttached = getConfig()?.attached ?? true
  let lastProgrammaticMoveAt = 0

  // Keep references to listeners so we can detach when toggling
  let detachMainMoveListener: (() => void) | undefined

  // Note: when attaching, we compute and persist the current relative offset
  // and start following without docking, so no immediate reposition is needed here.

  function computeRelativeOffset(win: BrowserWindow): { dx: number, dy: number } {
    const caption = win.getBounds()
    const main = params.mainWindow.getBounds()
    return { dx: caption.x - main.x, dy: caption.y - main.y }
  }

  function attachToMain(win: BrowserWindow) {
    const cfg = getConfig() ?? { attached: isAttached, matrices: {} }
    const initialOffset = cfg?.matrices?.[matrixHash]?.relativeToMain ?? computeRelativeOffset(win)

    // Store relative offset for this matrix
    const cfgToSave = getConfig() ?? { attached: isAttached, matrices: {} }
    cfgToSave.matrices[matrixHash] = { ...(cfgToSave.matrices[matrixHash] ?? {}), relativeToMain: initialOffset }
    updateConfig(cfgToSave)

    let anim: ReturnType<typeof animate> | null = null
    const state = { x: 0, y: 0 }

    const settleTo = (toX: number, toY: number) => {
      if (win.isDestroyed())
        return
      const b = win.getBounds()
      state.x = b.x
      state.y = b.y
      anim?.pause()
      anim = animate(state, {
        x: toX,
        y: toY,
        duration: 160,
        ease: 'outCubic',
        modifier: utils.round(0),
        onRender: () => {
          if (win.isDestroyed())
            return
          lastProgrammaticMoveAt = Date.now()
          win.setPosition(state.x, state.y)
        },
      })
    }

    let lastTx = 0
    let lastTy = 0
    let lastAppliedTx = Number.NaN
    let lastAppliedTy = Number.NaN
    const moveThrottled = throttle(() => {
      const stored = getConfig()?.matrices[matrixHash]?.relativeToMain ?? initialOffset
      const main = params.mainWindow.getBounds()
      const b = win.getBounds()
      let tx = main.x + stored.dx
      let ty = main.y + stored.dy
      const target = { x: tx, y: ty, width: b.width, height: b.height }
      const workArea = screen.getDisplayMatching(target).workArea
      const clamped = clampBoundsWithinRect(target, workArea)
      tx = clamped.x
      ty = clamped.y
      lastTx = tx
      lastTy = ty
      if (Math.abs(lastAppliedTx - tx) <= 0 && Math.abs(lastAppliedTy - ty) <= 0)
        return
      lastAppliedTx = tx
      lastAppliedTy = ty
      // Animate towards target at throttled cadence for visible easing
      settleTo(tx, ty)
    }, 1000 / 30)

    const settleDebounced = debounce(() => {
      settleTo(lastTx, lastTy)
    }, 200)

    const onMainChange = () => { moveThrottled(); settleDebounced() }
    params.mainWindow.on('move', onMainChange)
    params.mainWindow.on('resize', onMainChange)
    // Initialize target once
    onMainChange()
    detachMainMoveListener = () => {
      params.mainWindow.removeListener('move', onMainChange)
      params.mainWindow.removeListener('resize', onMainChange)
      anim?.pause()
      anim = null
    }
  }

  function detachFromMain() {
    detachMainMoveListener?.()
    detachMainMoveListener = undefined
  }

  let eventaContext: ReturnType<typeof createContext>['context'] | undefined

  const reusable = createReusableWindow(async () => {
    const window = createCaptionWindow()
    const { context } = createContext(ipcMain, window)
    eventaContext = context

    const cfg = getConfig()
    const saved = cfg?.matrices?.[matrixHash]?.bounds

    if (saved) {
      const workArea = screen.getDisplayMatching(saved).workArea
      const clamped = clampBoundsWithinRect(saved, workArea)
      window.setBounds(clamped)
    }
    else {
      const initialBounds = computeInitialCaptionBounds({ mainWindow: params.mainWindow })
      window.setBounds(initialBounds)
    }

    const persistBounds = () => {
      const config = getConfig() ?? { attached: isAttached, matrices: {} }
      const b = window.getBounds()
      config.matrices[matrixHash] = { ...(config.matrices[matrixHash] ?? {}), bounds: b }
      config.attached = isAttached
      if (isAttached && Date.now() - lastProgrammaticMoveAt > 100) {
        const rel = computeRelativeOffset(window)
        config.matrices[matrixHash] = { ...(config.matrices[matrixHash] ?? {}), bounds: b, relativeToMain: rel }
      }
      updateConfig(config)
    }
    window.on('resize', persistBounds)
    window.on('move', persistBounds)

    await load(window, withHashRoute(baseUrl(resolve(getElectronMainDirname(), '..', 'renderer')), '/caption'))

    const cleanupGetAttached = defineInvokeHandler(context, captionGetAttached, async () => isAttached)
    try { context.emit(captionAttachedChanged, isAttached) }
    catch {}

    if (isAttached) {
      attachToMain(window)
    }

    window.on('closed', () => {
      detachFromMain()
      try { cleanupGetAttached() }
      catch {}

      eventaContext = undefined
    })

    return window
  })

  async function getWindow(): Promise<BrowserWindow> { return reusable.getWindow() }

  async function setFollowWindow(attached: boolean) {
    isAttached = attached
    const window = await reusable.getWindow()
    if (isAttached) {
      // Compute and persist current relative offset based on existing positions
      const rel = computeRelativeOffset(window)
      const cfg = getConfig() ?? { attached: isAttached, matrices: {} }
      cfg.matrices[matrixHash] = { ...(cfg.matrices[matrixHash] ?? {}), relativeToMain: rel }
      updateConfig(cfg)
      // Start following main without re-docking; keep current position
      attachToMain(window)
    }
    else {
      detachFromMain()
    }

    const config = getConfig() ?? { attached: isAttached, matrices: {} }
    config.attached = isAttached
    updateConfig(config)

    // Keep window visible after toggle
    window.show()

    // Notify renderer for UI state (handle visibility)
    try { eventaContext?.emit(captionAttachedChanged, isAttached) }
    catch {}
  }

  async function toggleFollowWindow() {
    await setFollowWindow(!isAttached)
  }

  function getIsFollowingWindow(): boolean { return isAttached }

  async function resetToSide() {
    const window = await reusable.getWindow()

    // Prevent user-move persistence from overwriting our programmatic move
    lastProgrammaticMoveAt = Date.now()
    const initialBounds = computeInitialCaptionBounds({ mainWindow: params.mainWindow })
    window.setBounds(initialBounds)

    // Persist new bounds and a clean relative offset so follow uses it
    const config = getConfig() ?? { attached: isAttached, matrices: {} }
    const b = window.getBounds()

    const rel = computeRelativeOffset(window)
    config.matrices[matrixHash] = { ...(config.matrices[matrixHash] ?? {}), bounds: b, relativeToMain: rel }
    config.attached = isAttached

    updateConfig(config)
  }

  return {
    getWindow,
    setFollowWindow,
    toggleFollowWindow,
    getIsFollowingWindow,
    resetToSide,
  }
}
