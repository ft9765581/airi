import type { Ref } from 'vue'

import type { BackgroundProvider } from '../components/Backgrounds'
import type { BackgroundItem } from '../stores/background'

import Color from 'colorjs.io'

import { withRetry } from '@moeru/std'
import { colorFromElement, patchThemeSamplingHtml2CanvasClone } from '@proj-airi/stage-ui/libs'
import { useSettings } from '@proj-airi/stage-ui/stores/settings'
import { useTheme } from '@proj-airi/ui'
import { useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { nextTick, watch } from 'vue'

import { BackgroundKind } from '../stores/background'

export function themeColorFromPropertyOf(colorFromClass: string, property: string): () => Promise<string> {
  return async () => {
    const fetchUntilWidgetMounted = withRetry(() => {
      const widgets = document.querySelector(colorFromClass) as HTMLDivElement | undefined
      if (!widgets)
        throw new Error('Widgets element not found')

      return widgets
    }, { retry: 10, retryDelay: 1000 })

    const widgets = await fetchUntilWidgetMounted()
    return window.getComputedStyle(widgets).getPropertyValue(property)
  }
}

export function themeColorFromValue(value: string | { light: string, dark: string }): () => Promise<string> {
  return async () => {
    if (typeof value === 'string') {
      return value
    }
    else {
      const { isDark: dark } = useTheme()
      return dark.value ? value.dark : value.light
    }
  }
}

/**
 * Parses a CSS color for the document theme-color meta tag.
 *
 * An empty string throws inside colorjs.io (`Empty color reference`). The wave
 * background reads a computed style before the widgets mount, so that empty
 * value must not reach `new Color(...)`.
 */
function themeColorHex(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'none')
    return null

  try {
    return new Color(trimmed).to('srgb').toString({ format: 'hex' })
  }
  catch {
    return null
  }
}

export function useThemeColor(colorFrom: () => string | Promise<string>) {
  async function updateThemeColor() {
    if (!('document' in globalThis) || globalThis.document == null)
      return
    if (!('window' in globalThis) || globalThis.window == null)
      return

    let raw: string
    try {
      raw = await colorFrom()
    }
    catch {
      // The wave sampler retries until widgets exist. A failed read must not
      // tear down the page while the stage is still mounting.
      return
    }

    const hex = themeColorHex(raw)
    if (!hex)
      return

    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', hex)
  }

  return {
    updateThemeColor,
  }
}

export function useBackgroundThemeColor({
  backgroundSurface,
  selectedOption,
  sampledColor,
}: {
  backgroundSurface: Ref<InstanceType<typeof BackgroundProvider> | undefined | null>
  selectedOption: Ref<BackgroundItem | undefined>
  sampledColor: Ref<string>
}) {
  const visibility = useDocumentVisibility()
  const { themeColorsHueDynamic } = storeToRefs(useSettings())

  let samplingToken = 0

  const { isDark } = useTheme()
  const waveThemeColor = themeColorFromPropertyOf('.widgets.top-widgets .colored-area', 'background-color')

  const { updateThemeColor } = useThemeColor(() => {
    if (selectedOption.value?.kind === BackgroundKind.Wave) {
      return waveThemeColor()
    }

    if (selectedOption.value?.kind === BackgroundKind.Transparent) {
      return isDark.value ? 'rgb(18 18 18 / 0)' : 'rgb(255 255 255 / 0)'
    }

    return sampledColor.value
  })

  // Keep theme-color reasonably fresh for animated wave backgrounds without doing per-frame work.
  const { pause, resume } = useIntervalFn(() => {
    if (visibility.value !== 'visible')
      return
    if (selectedOption.value?.kind === BackgroundKind.Wave && themeColorsHueDynamic.value)
      void updateThemeColor()
  }, 250, { immediate: false })

  watch([() => selectedOption.value?.kind, () => themeColorsHueDynamic.value], ([kind, dynamic]) => {
    if (kind === BackgroundKind.Wave && dynamic) {
      void updateThemeColor()
      resume()
    }
    else {
      pause()
    }
  }, { immediate: true })

  async function waitForBackgroundReady() {
    await nextTick()
    const image = backgroundSurface.value?.surfaceEl?.querySelector('img')
    if (image && !image.complete) {
      await new Promise<void>((resolve, reject) => {
        image.addEventListener('load', () => resolve(), { once: true })
        image.addEventListener('error', () => reject(new Error('Background image failed to load')), { once: true })
      })
    }
  }

  // Exposed for optional manual triggers; also used within syncBackgroundTheme.
  async function sampleBackgroundColor() {
    const token = ++samplingToken
    const optionId = selectedOption.value?.id
    if (selectedOption.value?.kind === BackgroundKind.Wave) {
      await updateThemeColor()
      return
    }

    if (selectedOption.value?.kind === BackgroundKind.Transparent) {
      sampledColor.value = 'transparent'
      await updateThemeColor()
      return
    }

    const el = backgroundSurface.value?.surfaceEl
    if (!el)
      return

    await waitForBackgroundReady()

    const result = await colorFromElement(el, {
      mode: 'html2canvas',
      html2canvas: {
        region: {
          x: 0,
          y: 0,
          width: el.offsetWidth,
          height: Math.min(140, el.offsetHeight),
        },
        sampleHeight: 20,
        sampleStride: 10,
        scale: 0.5,
        backgroundColor: null,
        allowTaint: true,
        useCORS: true,
        onclone: patchThemeSamplingHtml2CanvasClone,
      },
    })

    const color = result.html2canvas?.average
    if (token !== samplingToken)
      return
    if (optionId && selectedOption.value?.id !== optionId)
      return

    if (color) {
      sampledColor.value = color
    }
  }

  async function syncBackgroundTheme() {
    try {
      if (selectedOption.value?.kind === BackgroundKind.Wave) {
        await updateThemeColor()
      }
      else if (themeColorHex(sampledColor.value)) {
        await updateThemeColor()
      }
      else {
        await sampleBackgroundColor()
      }
    }
    catch (error) {
      console.warn('[theme-color] background theme sync failed', error)
    }
  }

  watch([selectedOption], () => {
    void syncBackgroundTheme()
  }, { immediate: true })

  watch(sampledColor, () => {
    void syncBackgroundTheme()
  })

  watch(() => backgroundSurface.value?.surfaceEl, (el) => {
    if (el)
      void syncBackgroundTheme()
  })

  watch(isDark, () => {
    void syncBackgroundTheme()
  })

  return {
    sampledColor,
    sampleBackgroundColor,
    syncBackgroundTheme,
  }
}
