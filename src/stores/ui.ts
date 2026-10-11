import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUIStore = defineStore('ui', () => {
  const scale = ref(1)
  const panX = ref(0)
  const panY = ref(0)
  const showStylePanel = ref(true)
  const theme = ref<'dark' | 'light'>('light')

  function setScale(newScale: number): void {
    scale.value = Math.max(0.2, Math.min(3, newScale))
  }

  function zoomIn(): void {
    scale.value = Math.min(3, scale.value + 0.1)
  }

  function zoomOut(): void {
    scale.value = Math.max(0.2, scale.value - 0.1)
  }

  function resetView(): void {
    scale.value = 1
    panX.value = 0
    panY.value = 0
  }

  function pan(dx: number, dy: number): void {
    panX.value += dx
    panY.value += dy
  }

  function toggleStylePanel(): void {
    showStylePanel.value = !showStylePanel.value
  }

  function setTheme(newTheme: 'dark' | 'light'): void {
    theme.value = newTheme
    document.documentElement.setAttribute('data-theme', newTheme)
    try {
      localStorage.setItem('mindmap-theme', newTheme)
    } catch (e) {
      // ignore
    }
  }

  function loadTheme(): void {
    try {
      const saved = localStorage.getItem('mindmap-theme')
      if (saved === 'light' || saved === 'dark') {
        theme.value = saved
        document.documentElement.setAttribute('data-theme', saved)
      } else {
        setTheme('light')
      }
    } catch (e) {
      // ignore
    }
  }

  return {
    scale,
    panX,
    panY,
    showStylePanel,
    theme,
    setScale,
    zoomIn,
    zoomOut,
    resetView,
    pan,
    toggleStylePanel,
    setTheme,
    loadTheme
  }
})
