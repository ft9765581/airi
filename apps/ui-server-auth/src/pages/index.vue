<script setup lang="ts">
// This record exists so the bare `/ui/` URL matches a page instead of the
// catch-all. The redirect to `/profile` lives in `main.ts`: unplugin-vue-router
// does not emit `redirect` from a `<route>` block, so a block here would be
// dropped without a warning and this empty page would render a white screen.
</script>

<template>
  <div />
</template>
