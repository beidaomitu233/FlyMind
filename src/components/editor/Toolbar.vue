<template>
  <header class="toolbar">
    <div class="toolbar-left">
      <button class="nav-home-btn" @click="$router.push('/dashboard')" title="返回个人中心">
        <svg class="nav-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>

        <span>个人中心</span>
      </button>
      <span class="nav-divider"></span>

      <div v-if="!isEditingName" class="map-name-wrapper" @click="startEditName">
        <span class="map-name">{{ mapName }}</span>
        <svg class="edit-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </div>
      <input
        v-else
        ref="nameInputRef"
        class="map-name-input"
        :value="mapName"
        @input="handleNameInput"
        @blur="finishEditName"
        @keydown="handleNameKeydown"
        autofocus
      />
      <span v-if="isModified" class="modified-dot" title="未保存的更改"></span>
    </div>

    <div class="toolbar-center">
      <button class="tool-btn" title="撤销 (Ctrl+Z)" @click="handleUndo" :disabled="!canUndo">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 00-4-4H4"/>
        </svg>
        <span>撤销</span>
      </button>
      <button class="tool-btn" title="重做 (Ctrl+Y)" @click="handleRedo" :disabled="!canRedo">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 014-4h12"/>
        </svg>
        <span>重做</span>
      </button>

      <div class="toolbar-divider"></div>

      <button class="tool-btn" title="添加子主题 (Tab)" @click="handleAddTopic">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
        <span>子主题</span>
      </button>
      <button class="tool-btn" title="添加同级 (Enter)" @click="handleAddSibling">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>
        </svg>
        <span>同级</span>
      </button>
      <button class="tool-btn danger" title="删除 (Delete)" @click="handleDelete">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
        </svg>
        <span>删除</span>
      </button>

      <div class="toolbar-divider"></div>

      <button
        class="tool-btn accent"
        title="添加概括"
        @click="handleAddSummary"
        :disabled="mindMapStore.selectedNodeIds.length < 2"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M 8 4 C 11 4, 12 6, 12 9 L 12 10 C 12 11.5, 13 12, 16 12 C 13 12, 12 12.5, 12 13 L 12 15 C 12 18, 11 20, 8 20" />
        </svg>
        <span>概括</span>
      </button>
    </div>

    <div class="toolbar-right">
      <button
        class="theme-toggle tool-btn"
        :title="uiStore.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'"
        @click="toggleTheme"
      >
        <svg v-if="uiStore.theme === 'dark'" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
        <svg v-else width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
        </svg>
        <span>{{ uiStore.theme === 'dark' ? '浅色' : '深色' }}</span>
      </button>

      <div class="export-dropdown">
        <button class="export-btn tool-btn" @click="showExportMenu = !showExportMenu">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <span>导出</span>
        </button>
        <div v-if="showExportMenu" class="export-menu">
          <button @click="$emit('export-png'); showExportMenu = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <span>导出 PNG <span class="export-hint">（背景透明）</span></span>
          </button>
          <button @click="$emit('export-jpg'); showExportMenu = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            导出 JPG
          </button>
          <button @click="$emit('export-svg'); showExportMenu = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            导出 SVG
          </button>
          <button @click="$emit('export-md'); showExportMenu = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            导出 Markdown
          </button>
          <div class="export-menu-divider"></div>
          <button @click="$emit('export-fmd'); showExportMenu = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            导出 .fmd 文件
          </button>
        </div>
      </div>

      <button
        class="panel-toggle tool-btn"
        :class="{ active: uiStore.showStylePanel }"
        @click="uiStore.toggleStylePanel()"
        title="样式面板"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
        </svg>
        <span>样式</span>
      </button>

      <div class="user-avatar-wrapper" v-if="authStore.isAuthenticated" @click="$router.push('/dashboard')" :title="authStore.user?.username || '用户'">
        <img v-if="authStore.user?.avatar_url" :src="authStore.user.avatar_url" alt="avatar" class="toolbar-avatar" />
        <div v-else class="toolbar-avatar-placeholder">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
        </div>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useMindMapStore } from '@/stores/mindmap'
import { useUIStore } from '@/stores/ui'
import { useAuthStore } from '@/stores/auth'

defineProps<{
  mapName: string
  isModified: boolean
}>()

defineEmits<{
  save: []
  'export-png': []
  'export-jpg': []
  'export-svg': []
  'export-md': []
  'export-fmd': []
  'reset-view': []
}>()

const mindMapStore = useMindMapStore()
const uiStore = useUIStore()
const authStore = useAuthStore()
const showExportMenu = ref(false)
const isEditingName = ref(false)
const nameInputRef = ref<HTMLInputElement | null>(null)
const tempName = ref('')

const canUndo = computed(() => mindMapStore.canUndo)
const canRedo = computed(() => mindMapStore.canRedo)

function startEditName(): void {
  isEditingName.value = true
  tempName.value = mindMapStore.currentMap?.name || ''
  nextTick(() => {
    nameInputRef.value?.focus()
    nameInputRef.value?.select()
  })
}

function finishEditName(): void {
  if (tempName.value.trim()) {
    mindMapStore.updateMapName(tempName.value.trim())
  }
  isEditingName.value = false
}

function handleNameInput(e: Event): void {
  tempName.value = (e.target as HTMLInputElement).value
}

function handleNameKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault()
    finishEditName()
  } else if (e.key === 'Escape') {
    isEditingName.value = false
  }
}

function toggleTheme(): void {
  const newTheme = uiStore.theme === 'dark' ? 'light' : 'dark'
  uiStore.setTheme(newTheme)
}

function handleUndo(): void { mindMapStore.undo() }
function handleRedo(): void { mindMapStore.redo() }

function handleAddTopic(): void {
  const selectedId = mindMapStore.selectedNodeId
  if (selectedId) mindMapStore.addChildNode(selectedId)
}

function handleAddSibling(): void {
  const selectedId = mindMapStore.selectedNodeId
  if (selectedId) mindMapStore.addSiblingNode(selectedId)
}

function handleDelete(): void {
  const selectedId = mindMapStore.selectedNodeId
  if (selectedId) mindMapStore.deleteNode(selectedId)
}

function handleAddSummary(): void {
  mindMapStore.addSummary()
}

function handleKeyDown(e: KeyboardEvent): void {
  if (isEditingName.value) return

  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault()
    mindMapStore.undo()
    return
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault()
    mindMapStore.redo()
    return
  }

  if (mindMapStore.editingNodeId) return

  if (e.key === 'Tab') {
    e.preventDefault()
    const selectedId = mindMapStore.selectedNodeId
    if (selectedId) mindMapStore.addChildNode(selectedId)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const selectedId = mindMapStore.selectedNodeId
    if (selectedId) mindMapStore.addSiblingNode(selectedId)
  } else if (e.key === 'Delete') {
    const selectedId = mindMapStore.selectedNodeId
    if (selectedId) mindMapStore.deleteNode(selectedId)
  } else if (e.key === 'F2') {
    e.preventDefault()
    const selectedId = mindMapStore.selectedNodeId
    if (selectedId) mindMapStore.startEditing(selectedId)
  } else if (e.key === 'Escape') {
    mindMapStore.selectNode(null)
    showExportMenu.value = false
  }
}

onMounted(() => { window.addEventListener('keydown', handleKeyDown) })
onUnmounted(() => { window.removeEventListener('keydown', handleKeyDown) })
</script>

<style scoped>
.toolbar {
  height: auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  gap: 12px;
  margin: 10px 16px 0 16px;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.06);
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 180px;
}

.nav-home-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: transparent;
  color: var(--text-secondary);
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid var(--border-color);
  cursor: pointer;
  transition: all 0.18s;
  white-space: nowrap;
  flex-shrink: 0;
}

.nav-home-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--accent-color);
}

.nav-arrow {
  flex-shrink: 0;
}

.nav-divider {
  width: 1px;
  height: 14px;
  background: var(--border-color);
  flex-shrink: 0;
}

.nav-home-btn:hover .nav-divider {
  background: var(--text-muted);
}

.nav-user-icon {
  flex-shrink: 0;
}

.map-name-wrapper {
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  padding: 5px 8px;
  border-radius: 7px;
  transition: background 0.18s;
}

.map-name-wrapper:hover { background: var(--bg-hover); }

.map-name {
  font-size: 14px;
  font-weight: 600;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.edit-icon {
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.18s;
  color: var(--text-muted);
}

.map-name-wrapper:hover .edit-icon { opacity: 1; }

.map-name-input {
  font-size: 14px;
  font-weight: 600;
  padding: 5px 8px;
  background: var(--bg-input);
  border: 1.5px solid var(--accent-color);
  border-radius: 7px;
  color: var(--text-primary);
  max-width: 180px;
  outline: none;
}

.modified-dot {
  width: 7px;
  height: 7px;
  background: #f59e0b;
  border-radius: 50%;
  flex-shrink: 0;
}

/* ---- TOOLBAR CENTER ---- */
.toolbar-center {
  display: flex;
  gap: 3px;
  align-items: center;
}

.toolbar-divider {
  width: 1px;
  height: 22px;
  background: var(--border-color);
  margin: 0 5px;
}

/* Shared tool button */
.tool-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 10px;
  background: transparent;
  color: var(--text-secondary);
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.18s;
  white-space: nowrap;
}

.tool-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-color);
}

.tool-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.tool-btn.danger:hover:not(:disabled) {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.25);
}

.tool-btn.accent:hover:not(:disabled) {
  color: var(--accent-color);
  background: rgba(139, 92, 246, 0.08);
  border-color: rgba(139, 92, 246, 0.25);
}

.tool-btn.active {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-color);
}

/* ---- TOOLBAR RIGHT ---- */
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.zoom-controls {
  display: flex;
  align-items: center;
  gap: 2px;
  background: var(--bg-card);
  border-radius: 8px;
  padding: 3px 4px;
  border: 1px solid var(--border-color);
}

.zoom-btn {
  background: transparent;
  color: var(--text-secondary);
  padding: 4px 9px;
  border-radius: 5px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.15s;
}

.zoom-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.zoom-level {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  min-width: 42px;
  text-align: center;
}

/* Export dropdown */
.export-dropdown { position: relative; }

.export-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 5px;
  min-width: 150px;
  z-index: 999;
  box-shadow: 0 8px 24px rgba(0,0,0,0.18);
}

.export-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 12px;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  border: none;
  transition: background 0.15s;
}

.export-menu button:hover { background: var(--bg-hover); }

.export-menu-divider {
  height: 1px;
  background: var(--border-color);
  margin: 4px 8px;
}

.export-hint {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 400;
}

.user-avatar-wrapper {
  margin-left: 4px;
  cursor: pointer;
  flex-shrink: 0;
}

.toolbar-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--border-color);
  transition: border-color 0.18s;
}

.toolbar-avatar:hover {
  border-color: var(--accent-color);
}

.toolbar-avatar-placeholder {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--bg-hover);
  border: 2px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  transition: all 0.18s;
}

.user-avatar-wrapper:hover .toolbar-avatar-placeholder {
  border-color: var(--accent-color);
  color: var(--accent-color);
}
</style>
