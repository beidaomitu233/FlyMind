<template>
  <div class="dashboard" @click="closeContextMenu">
    <aside class="sidebar">
      <div class="logo" @click="router.push('/')">
        <div class="logo-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="12" cy="12" r="3"/><line x1="12" y1="5" x2="12" y2="1"/><line x1="12" y1="23" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="1" y2="12"/><line x1="23" y1="12" x2="19" y2="12"/>
            <line x1="7.05" y1="7.05" x2="4.22" y2="4.22"/><line x1="19.78" y1="19.78" x2="16.95" y2="16.95"/>
            <line x1="7.05" y1="16.95" x2="4.22" y2="19.78"/><line x1="19.78" y1="4.22" x2="16.95" y2="7.05"/>
          </svg>
        </div>
        <span class="logo-text">FlyMind</span>
      </div>

      <div class="user-profile" @click="showUserMenu = !showUserMenu">
        <div class="avatar">
          <img v-if="authStore.user?.avatar_url" :src="authStore.user.avatar_url" alt="avatar" class="avatar-img" />
          <svg v-else width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
          </svg>
        </div>
        <span class="username">{{ authStore.user?.username || '用户' }}</span>

        <div v-if="showUserMenu" class="user-menu" @click.stop>
          <button @click="handleLogout">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            退出登录
          </button>
        </div>
      </div>

      <button class="generate-btn" @click="handleAIGenerate">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 2L9.5 5.5L13 7L9.5 8.5L8 12L6.5 8.5L3 7L6.5 5.5L8 2Z"/>
        </svg>
        一键生成
      </button>

      <div class="nav">
        <div 
          class="nav-item" 
          :class="{ active: currentTab === 'recent' }"
          @click="currentTab = 'recent'"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
            <path d="M9 2a7 7 0 100 14A7 7 0 009 2zm0 1.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11zm-.5 2v4.2l3.2 1.9.8-1.2-2.5-1.5V5.5h-1.5z"/>
          </svg>
          最近
        </div>
        <div 
          class="nav-item" 
          :class="{ active: currentTab === 'trash' }"
          @click="currentTab = 'trash'"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
            <path d="M4 4h10v1H4zM5 6h8v8a1 1 0 01-1 1H6a1 1 0 01-1-1V6zm2 1v6h1V7H7zm3 0v6h1V7h-1zM6.5 2h5v1h-5z"/>
          </svg>
          回收站
        </div>
        <div class="nav-item" @click="triggerImportInput">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
            <path d="M2 4a1 1 0 011-1h4l2 2h6a1 1 0 011 1v7a1 1 0 01-1 1H3a1 1 0 01-1-1V4zm1 1v8h12V6h-5.586l-2-2H3z"/>
          </svg>
          导入 .fmd 文件
          <input ref="importInputRef" type="file" accept=".fmd" class="hidden-file-input" @change="handleImportFile" />
        </div>
      </div>

      <div class="sidebar-footer">
        <button
          class="theme-btn"
          @click="toggleTheme"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11z"/>
            <path d="M8 3a5 5 0 000 10V3z" opacity="0.3"/>
          </svg>
          <span>首选项</span>
        </button>
      </div>
    </aside>

    <main class="main-content">
      <header class="header">
        <h1>{{ currentTab === 'recent' ? '最近' : '回收站' }}</h1>
      </header>

      <div class="file-grid">
        <div v-if="currentTab === 'recent'" class="file-card new-card" @click="showTemplates = true">
          <div class="new-icon">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="currentColor">
              <path d="M20 8a1.5 1.5 0 011.5 1.5v9h9a1.5 1.5 0 010 3h-9v9a1.5 1.5 0 01-3 0v-9h-9a1.5 1.5 0 010-3h9v-9A1.5 1.5 0 0120 8z"/>
            </svg>
          </div>
          <span class="file-name">新建导图</span>
        </div>

        <div
          v-for="file in displayFiles"
          :key="file.id"
          class="file-card"
          @click="currentTab === 'recent' ? openFile(file.id) : null"
          @contextmenu.prevent="handleContextMenu($event, file.id)"
        >
          <div class="file-thumbnail">
            <img v-if="file.thumbnail" :src="file.thumbnail" :alt="file.name" />
            <div v-else class="thumbnail-placeholder">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="var(--text-muted)">
                <circle cx="20" cy="20" r="8" stroke="currentColor" stroke-width="2" fill="none"/>
                <line x1="28" y1="20" x2="34" y2="20" stroke="currentColor" stroke-width="2"/>
                <line x1="6" y1="20" x2="12" y2="20" stroke="currentColor" stroke-width="2"/>
                <line x1="20" y1="12" x2="20" y2="6" stroke="currentColor" stroke-width="2"/>
                <line x1="20" y1="28" x2="20" y2="34" stroke="currentColor" stroke-width="2"/>
              </svg>
            </div>
          </div>
          <span class="file-name">{{ file.name }}</span>
          <span class="file-time">{{ formatTime(file.updatedAt) }}</span>
        </div>
      </div>
    </main>

    <div 
      v-if="contextMenu"
      class="context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
    >
      <template v-if="currentTab === 'recent'">
        <button @click="doMoveToTrash">移至回收站</button>
      </template>
      <template v-else>
        <button @click="doRestore">还原</button>
        <button @click="doDeletePermanently" class="danger">彻底删除</button>
      </template>
    </div>

    <TemplateSelector
      v-if="showTemplates"
      @close="showTemplates = false"
      @create="createMap"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useMindMapStore } from '@/stores/mindmap'
import { useUIStore } from '@/stores/ui'
import { useAuthStore } from '@/stores/auth'
import { getAllFiles, getTrashFiles, moveToTrash, restoreFile, deleteFilePermanently } from '@/utils/api'
import { importFMD } from '@/utils/import'
import TemplateSelector from './TemplateSelector.vue'

const router = useRouter()
const mindMapStore = useMindMapStore()
const uiStore = useUIStore()
const authStore = useAuthStore()
const showTemplates = ref(false)
const showUserMenu = ref(false)
const currentTab = ref<'recent' | 'trash'>('recent')
const importInputRef = ref<HTMLInputElement | null>(null)

const recentFiles = ref<any[]>([])
const trashFiles = ref<any[]>([])

const contextMenu = ref<{ id: string, x: number, y: number } | null>(null)

async function refreshFiles() {
  recentFiles.value = await getAllFiles()
  trashFiles.value = await getTrashFiles()
}

const displayFiles = computed(() => {
  return currentTab.value === 'recent' ? recentFiles.value : trashFiles.value
})

onMounted(() => {
  uiStore.loadTheme()
  refreshFiles()
})

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 7) return `${days}天前`
  return date.toLocaleDateString('zh-CN')
}

function openFile(id: string): void {
  router.push(`/editor/${id}`)
}

async function createMap(name: string, layout: any = 'logic') {
  showTemplates.value = false
  const newMap = mindMapStore.createNewMap(name)
  newMap.layout = layout
  mindMapStore.currentMap = newMap
  await mindMapStore.saveCurrentMap()
  router.push(`/editor/${newMap.id}`)
}

function handleContextMenu(e: MouseEvent, id: string) {
  contextMenu.value = {
    id,
    x: e.clientX,
    y: e.clientY
  }
}

function closeContextMenu() {
  contextMenu.value = null
}

async function doMoveToTrash() {
  if (!contextMenu.value) return
  await moveToTrash(contextMenu.value.id)
  await refreshFiles()
  closeContextMenu()
}

async function doRestore() {
  if (!contextMenu.value) return
  await restoreFile(contextMenu.value.id)
  await refreshFiles()
  closeContextMenu()
}

async function doDeletePermanently() {
  if (!contextMenu.value) return
  if (confirm('确定要彻底删除该导图吗？删除后无法恢复。')) {
    await deleteFilePermanently(contextMenu.value.id)
    await refreshFiles()
  }
  closeContextMenu()
}

function toggleTheme(): void {
  const newTheme = uiStore.theme === 'dark' ? 'light' : 'dark'
  uiStore.setTheme(newTheme)
}

function handleLogout(): void {
  showUserMenu.value = false
  authStore.logout()
  router.push('/login')
}

async function handleAIGenerate(): Promise<void> {
  const prompt = window.prompt('请输入你想生成的思维导图主题：')
  if (!prompt?.trim()) return

  const newMap = mindMapStore.createNewMap(prompt.trim().substring(0, 20))
  newMap.layout = 'logic'
  mindMapStore.currentMap = newMap

  // Store prompt for editor to pick up
  sessionStorage.setItem('currentPrompt', prompt.trim())
  sessionStorage.setItem('mapId', newMap.id)

  await mindMapStore.saveCurrentMap()
  router.push(`/editor/${newMap.id}`)
}

function triggerImportInput(): void {
  importInputRef.value?.click()
}

async function handleImportFile(e: Event): Promise<void> {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const result = await importFMD(file)
    const newMap = mindMapStore.createNewMap(result.name)
    newMap.root = result.data.root
    if (result.data.theme) newMap.theme = result.data.theme
    if (result.data.layout) newMap.layout = result.data.layout as any
    mindMapStore.currentMap = newMap
    await mindMapStore.saveCurrentMap()
    router.push(`/editor/${newMap.id}`)
  } catch (err: any) {
    alert(`导入失败：${err.message}`)
  }
  // Reset file input
  if (importInputRef.value) importInputRef.value.value = ''
}
</script>

<style scoped>
.dashboard {
  display: flex;
  height: 100vh;
  background: var(--bg-primary);
  position: relative;
}

.sidebar {
  width: 240px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.logo {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  margin-bottom: 8px;
  cursor: pointer;
  transition: opacity 0.2s;
}

.logo:hover {
  opacity: 0.8;
}

.logo-icon {
  width: 24px;
  height: 24px;
  background: var(--accent-color);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 14px;
  color: #fff;
}

.logo-text {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.user-profile {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
  position: relative;
}

.user-profile:hover {
  background: var(--bg-hover);
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--border-color);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.username {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.avatar-img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
}

.user-menu {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 4px;
  z-index: 100;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  margin-top: 4px;
}

.user-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-primary);
  background: transparent;
  border-radius: 4px;
  border: none;
  cursor: pointer;
}

.user-menu button:hover {
  background: var(--bg-hover);
}

.generate-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  background: #8b5cf6;
  color: white;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  transition: background 0.2s;
  width: 100%;
}

.generate-btn:hover {
  background: #7c3aed;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.nav-item.active {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.sidebar-footer {
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}

.theme-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  color: var(--text-secondary);
  border-radius: 8px;
  font-size: 13px;
  transition: all 0.2s;
}

.theme-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.main-content {
  flex: 1;
  padding: 24px 32px;
  overflow-y: auto;
}

.header h1 {
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 24px;
  color: var(--text-primary);
}

.file-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 20px;
}

.file-card {
  background: var(--bg-card);
  border-radius: 12px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
}

.file-card:hover {
  border-color: var(--accent-color);
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
}

.new-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 160px;
  border: 1.5px dashed var(--border-light);
  background: var(--bg-secondary);
  box-shadow: var(--shadow-sm);
}

.new-card:hover {
  border-color: var(--accent-color);
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
  background: var(--bg-hover);
}

.new-icon {
  color: var(--accent-color);
  margin-bottom: 10px;
  transition: transform 0.25s ease;
}

.new-card:hover .new-icon {
  transform: scale(1.1);
}

.file-thumbnail {
  width: 100%;
  aspect-ratio: 16/10;
  background: linear-gradient(135deg, var(--bg-primary) 0%, var(--bg-tertiary) 100%);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 10px;
  border: 1px solid var(--border-color);
  transition: border-color 0.25s ease;
  box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.05);
}

.file-card:hover .file-thumbnail {
  border-color: var(--border-light);
}

.file-thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s ease;
}

.file-card:hover .file-thumbnail img {
  transform: scale(1.02);
}

.thumbnail-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.75;
}

.file-name {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

.file-time {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 4px;
}

.context-menu {
  position: fixed;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  border-radius: 8px;
  padding: 4px;
  z-index: 100;
  min-width: 120px;
}

.context-menu button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-primary);
  background: transparent;
  border-radius: 4px;
}

.context-menu button:hover {
  background: var(--bg-hover);
}

.context-menu button.danger {
  color: #ef4444;
}

.context-menu button.danger:hover {
  background: #ef444420;
}

.hidden-file-input {
  display: none;
}
</style>
