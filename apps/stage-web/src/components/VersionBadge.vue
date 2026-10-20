<script setup lang="ts">
import { readBuildInfo } from '@proj-airi/stage-ui/libs/build-info'

const { configVersion, buildFile } = readBuildInfo()

// A short form for the stage corner: the value a support request needs.
const label = [configVersion, buildFile || 'dev'].filter(Boolean).join(' · ')
</script>

<template>
  <div
    :class="[
      'pointer-events-none fixed bottom-1 right-2 z-30 select-none',
      'text-[11px] font-mono text-neutral-500/70',
      'dark:text-neutral-400/60',
    ]"
  >
    {{ label }}
  </div>
</template>
