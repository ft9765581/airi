import { isEnvTruthy } from '@proj-airi/stage-shared'
import { ToasterPWAUpdateReady } from '@proj-airi/stage-ui/components'
import { breakpointsTailwind, useBreakpoints } from '@vueuse/core'
import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { h, markRaw, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'

export const usePWAStore = defineStore('pwa', () => {
  const updateReadyHooks = ref<(() => void)[]>([])
  const breakpoints = useBreakpoints(breakpointsTailwind)
  const isMobile = breakpoints.smaller('md')

  onMounted(async () => {
    if (import.meta.env.SSR) {
      return
    }
    if (isEnvTruthy(import.meta.env.VITE_APP_TARGET_HUGGINGFACE_SPACE)) {
      return
    }

    const { registerSW } = await import('../modules/pwa')

    const updateSW = registerSW({
      onNeedRefresh: () => {
        const id = nanoid()
        toast.custom(markRaw(h(ToasterPWAUpdateReady, { id, onUpdate: () => updateSW() })), {
          id,
          // Keep the prompt until the user answers it. A toast that expires is
          // easy to miss, and the waiting service worker then keeps serving the
          // old bundle, so a deployed fix still looks broken in that browser.
          duration: Number.POSITIVE_INFINITY,
          position: isMobile.value ? 'top-center' : 'bottom-right',
        })
      },
    })

    updateReadyHooks.value.push(updateSW)
  })
})
