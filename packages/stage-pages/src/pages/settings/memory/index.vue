<script setup lang="ts">
import { LongTermMemorySettings } from '@proj-airi/stage-ui/components'
</script>

<template>
  <LongTermMemorySettings />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.memory-long-term.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.modules.memory-long-term.description
  icon: i-solar:book-bookmark-bold-duotone
  settingsEntry: true
  order: 5
  stageTransition:
    name: slide
</route>
