<template>
  <path
    class="mind-connection"
    :d="pathData"
    :stroke="color"
    :stroke-width="strokeWidth || 2"
    fill="none"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  startX: number
  startY: number
  endX: number
  endY: number
  color: string
  strokeWidth?: number
  isVertical?: boolean
  connectionStyle?: 'curved' | 'straight' | 'elbowed'
}>()

const pathData = computed(() => {
  const { startX, startY, endX, endY, isVertical, connectionStyle } = props
  const style = connectionStyle || 'curved'
  const dx = endX - startX
  const dy = endY - startY

  if (style === 'straight') {
    return `M ${startX} ${startY} L ${endX} ${endY}`
  }

  if (style === 'elbowed') {
    if (isVertical) {
      // L-shaped: go halfway down, then horizontal
      const midY = startY + dy / 2
      return `M ${startX} ${startY} L ${startX} ${midY} L ${endX} ${midY} L ${endX} ${endY}`
    } else {
      // L-shaped: go halfway horizontally, then vertical
      const midX = startX + dx / 2
      return `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`
    }
  }

  // Default: curved (cubic bezier)
  if (isVertical) {
    const cp = Math.max(Math.abs(dy) * 0.5, 30)
    const cp1y = startY + (dy > 0 ? cp : -cp)
    const cp2y = endY - (dy > 0 ? cp : -cp)
    return `M ${startX} ${startY} C ${startX} ${cp1y}, ${endX} ${cp2y}, ${endX} ${endY}`
  } else {
    const cp = Math.abs(dx) * 0.5
    const sign = dx > 0 ? 1 : -1
    const cp1x = startX + sign * cp
    const cp2x = endX - sign * cp
    return `M ${startX} ${startY} C ${cp1x} ${startY}, ${cp2x} ${endY}, ${endX} ${endY}`
  }
})
</script>
