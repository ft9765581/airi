<script setup lang="ts">
import { useTheme } from '@proj-airi/ui'
import { RouterLink } from 'vue-router'

import LogoDark from '../../assets/logo-dark.svg'
import Logo from '../../assets/logo.svg'

const { isDark: dark } = useTheme()

// This fork ships as a white-label product, so the brand comes from the build
// environment. The default replaces the upstream name, because a build without
// `VITE_APP_NAME` would otherwise show the upstream brand to end users.
const appName = import.meta.env.VITE_APP_NAME || '清锡医疗'
</script>

<template>
  <RouterLink
    to="/" flex="~"
    w-max items-center gap-2 px-2 text-nowrap text-2xl outline-none
  >
    <template v-if="dark">
      <img :src="LogoDark" h-8 w-8 class="theme-colored">
    </template>
    <template v-else>
      <img :src="Logo" h-8 w-8 class="theme-colored">
    </template>
    <div translate-y="[2px]" font-quicksand font-semibold>
      <span>{{ appName }}</span>
    </div>
  </RouterLink>
</template>

<style scoped>
.theme-colored {
  filter: hue-rotate(calc(var(--chromatic-hue, 0) * 1deg));
}
</style>
