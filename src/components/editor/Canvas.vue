<template>
  <div
    ref="containerRef"
    class="canvas-container"
    @mousedown="handleMouseDown"
    @mousemove="handleMouseMove"
    @mouseup="handleMouseUp"
    @mouseleave="handleMouseUp"
    @wheel.prevent="handleWheel"
    @click.self="handleClickCanvas"
  >
    <div class="canvas-content" :style="canvasStyle">
      <MindMapSVG />
    </div>

    <!-- Floating zoom & center controls at bottom right -->
    <div class="canvas-controls">
      <button class="control-btn" @click="centerView" title="居中/重置视图">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
        </svg>
      </button>
      <div class="controls-divider"></div>
      <button class="control-btn zoom" @click="handleZoomOut" title="缩小">−</button>
      <span class="zoom-text">{{ Math.round(uiStore.scale * 100) }}%</span>
      <button class="control-btn zoom" @click="handleZoomIn" title="放大">+</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useUIStore } from '@/stores/ui'
import { useMindMapStore } from '@/stores/mindmap'
import MindMapSVG from './MindMapSVG.vue'
import { parseMarkdown, stringifyMarkdown } from '@/utils/markdown'

function handleZoomIn(): void {
  zoomAtCenter(0.1)
}

function handleZoomOut(): void {
  zoomAtCenter(-0.1)
}

function zoomAtCenter(delta: number): void {
  if (!containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  const centerX = rect.width / 2
  const centerY = rect.height / 2
  const prevScale = uiStore.scale
  const newScale = Math.max(0.15, Math.min(4, prevScale + delta))
  const scaleDiff = newScale - prevScale
  uiStore.setScale(newScale)
  uiStore.pan(-centerX * scaleDiff / newScale, -centerY * scaleDiff / newScale)
}

function centerView(): void {
  if (containerRef.value) {
    const rect = containerRef.value.getBoundingClientRect()
    const w = rect.width || window.innerWidth
    const h = rect.height || window.innerHeight
    uiStore.setScale(1)
    uiStore.panX = Math.round(w / 2 - 4000)
    uiStore.panY = Math.round(h / 2 - 3000)
  }
}

defineExpose({
  centerView
})

const uiStore = useUIStore()
const mindMapStore = useMindMapStore()
const containerRef = ref<HTMLDivElement | null>(null)

const isPanning = ref(false)
const lastMouse = ref({ x: 0, y: 0 })

const canvasStyle = computed(() => ({
  transform: `translate(${uiStore.panX}px, ${uiStore.panY}px) scale(${uiStore.scale})`,
  transformOrigin: '0 0'
}))

function handleClickCanvas() {
  // Click on blank canvas deselects
  if (!isPanning.value) {
    mindMapStore.selectNode(null)
  }
}

function handleMouseDown(e: MouseEvent): void {
  // Middle button always pans; left button only pans if not on a node
  if (e.button === 1 || e.button === 0) {
    isPanning.value = true
    lastMouse.value = { x: e.clientX, y: e.clientY }
    if (containerRef.value) {
      containerRef.value.style.cursor = 'grabbing'
    }
  }
}

function handleMouseMove(e: MouseEvent): void {
  if (!isPanning.value) return

  const dx = e.clientX - lastMouse.value.x
  const dy = e.clientY - lastMouse.value.y

  uiStore.pan(dx, dy)
  lastMouse.value = { x: e.clientX, y: e.clientY }
}

function handleMouseUp(): void {
  isPanning.value = false
  if (containerRef.value) {
    containerRef.value.style.cursor = 'crosshair'
  }
}

function handleWheel(e: WheelEvent): void {
  if (e.ctrlKey || e.metaKey) {
    // Ctrl+Wheel = zoom
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.08 : 0.08
    const rect = containerRef.value?.getBoundingClientRect()
    if (rect) {
      // Zoom towards cursor
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      const prevScale = uiStore.scale
      const newScale = Math.max(0.15, Math.min(4, prevScale + delta))
      const scaleDiff = newScale - prevScale
      uiStore.setScale(newScale)
      uiStore.pan(-mouseX * scaleDiff / newScale, -mouseY * scaleDiff / newScale)
    } else {
      const delta2 = e.deltaY > 0 ? -0.08 : 0.08
      uiStore.setScale(uiStore.scale + delta2)
    }
  } else {
    // Normal scroll = pan vertically; Shift+scroll = pan horizontally
    const panAmount = e.shiftKey ? [-e.deltaY, 0] : [0, -e.deltaY]
    uiStore.pan(panAmount[0], panAmount[1])
  }
}

async function handleCopy(e: ClipboardEvent) {
  if (mindMapStore.editingNodeId) return
  if (mindMapStore.selectedNodeId && mindMapStore.currentMap) {
    const node = mindMapStore.findNode(mindMapStore.currentMap.root, mindMapStore.selectedNodeId)
    if (node) {
      const markdown = stringifyMarkdown(node)
      e.clipboardData?.setData('text/plain', markdown)
      e.preventDefault()
    }
  }
}

async function handlePaste(e: ClipboardEvent) {
  if (mindMapStore.editingNodeId) return
  const text = e.clipboardData?.getData('text/plain')
  if (text && mindMapStore.selectedNodeId && mindMapStore.currentMap) {
    const newNodes = parseMarkdown(text)
    if (newNodes.length > 0) {
      const targetNode = mindMapStore.findNode(mindMapStore.currentMap.root, mindMapStore.selectedNodeId)
      if (targetNode) {
        targetNode.children.push(...newNodes)
        mindMapStore.saveCurrentMap()
        e.preventDefault()
      }
    }
  }
}

onMounted(() => {
  if (containerRef.value) {
    containerRef.value.style.cursor = 'crosshair'
  }
  window.addEventListener('copy', handleCopy)
  window.addEventListener('paste', handlePaste)
  
  setTimeout(() => {
    centerView()
  }, 50)
})

onUnmounted(() => {
  window.removeEventListener('copy', handleCopy)
  window.removeEventListener('paste', handlePaste)
})
</script>

<style scoped>
.canvas-container {
  flex: 1;
  overflow: hidden;
  background-color: var(--bg-primary);
  background-image: radial-gradient(rgba(100, 116, 139, 0.12) 1.5px, transparent 1.5px);
  background-size: 24px 24px;
  position: relative;
  outline: none;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.05);
  border: 1px solid var(--border-color);
  cursor: crosshair;
}

.canvas-content {
  /* Must be larger than the viewport so nodes don't clip */
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  /* No overflow hidden here — the outer clips */
  will-change: transform;
}

.canvas-controls {
  position: absolute;
  bottom: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 4px 6px;
  box-shadow: var(--shadow-md);
  z-index: 10;
  user-select: none;
}

.control-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.control-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.control-btn.zoom {
  font-size: 16px;
  font-weight: 500;
}

.zoom-text {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  min-width: 36px;
  text-align: center;
}

.controls-divider {
  width: 1px;
  height: 16px;
  background: var(--border-color);
  margin: 0 4px;
}
</style>
