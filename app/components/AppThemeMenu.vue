<template>
  <UDropdownMenu :items="items" :content="{ align: 'end', sideOffset: 8 }" :ui="{ content: 'w-56' }">
    <UButton
      icon="i-lucide-palette"
      color="neutral"
      variant="ghost"
      square
      :aria-label="`主题：${currentThemeName}`"
      data-testid="theme-menu"
    />
  </UDropdownMenu>
</template>

<script setup lang="ts">
const { themes, themeId, colorMode, initialize, setTheme, setMode } = useAppTheme()

onMounted(initialize)

const currentThemeName = computed(() => themes.find(theme => theme.id === themeId.value)?.name || '')
const items = computed(() => [
  [
    { type: 'label', label: '主题风格' },
    ...themes.map(theme => ({
      label: theme.name,
      icon: themeId.value === theme.id ? 'i-lucide-check' : 'i-lucide-circle',
      color: themeId.value === theme.id ? 'primary' : 'neutral',
      onSelect: () => setTheme(theme.id)
    }))
  ],
  [
    { type: 'label', label: '明暗模式' },
    {
      label: '浅色',
      icon: colorMode.value === 'light' ? 'i-lucide-check' : 'i-lucide-sun',
      color: colorMode.value === 'light' ? 'primary' : 'neutral',
      onSelect: () => setMode('light')
    },
    {
      label: '深色',
      icon: colorMode.value === 'dark' ? 'i-lucide-check' : 'i-lucide-moon',
      color: colorMode.value === 'dark' ? 'primary' : 'neutral',
      onSelect: () => setMode('dark')
    }
  ]
])
</script>
