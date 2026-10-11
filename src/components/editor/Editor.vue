<template>
  <div class="editor">
    <Toolbar
      :map-name="mindMapStore.currentMap?.name || ''"
      :is-modified="mindMapStore.isModified"
      @save="mindMapStore.saveCurrentMap()"
      @export-png="handleExport('png')"
      @export-jpg="handleExport('jpg')"
      @export-svg="handleExportSVG"
      @export-md="handleExportMarkdown"
      @export-fmd="handleExportFMD"
      @reset-view="handleResetView"
    />

    <!-- AI Generation inline indicator -->
    <div v-if="mindMapStore.aiGenerating" class="ai-indicator">
      <div class="ai-indicator-dot"></div>
      <span>AI 正在生成中...</span>
    </div>

    <!-- Login prompt dialog -->
    <div v-if="showLoginPrompt" class="login-prompt-overlay" @click.self="showLoginPrompt = false">
      <div class="login-prompt-card">
        <button class="login-close-btn" @click="showLoginPrompt = false">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div class="login-prompt-header">
          <div class="login-brand-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <circle cx="12" cy="12" r="3"/><line x1="12" y1="5" x2="12" y2="1"/><line x1="12" y1="23" x2="12" y2="19"/><line x1="5" y1="12" x2="1" y2="12"/><line x1="23" y1="12" x2="19" y2="12"/>
            </svg>
          </div>
          <h3>登录 FlyMind</h3>
          <p>登录后即可保存和导出您的思维导图</p>
        </div>

        <div class="login-tabs">
          <button
            v-for="tab in loginTabs"
            :key="tab.id"
            class="login-tab"
            :class="{ active: loginActiveTab === tab.id }"
            @click="loginActiveTab = tab.id"
          >{{ tab.label }}</button>
        </div>

        <form @submit.prevent="handleLoginSubmit" class="login-form">
          <div v-if="loginActiveTab === 'register'" class="login-field">
            <label>用户名</label>
            <input v-model="loginForm.username" type="text" placeholder="请输入用户名" required />
          </div>
          <div v-if="loginActiveTab === 'login-user'" class="login-field">
            <label>用户名</label>
            <input v-model="loginForm.username" type="text" placeholder="请输入用户名" required />
          </div>
          <div v-if="loginActiveTab === 'login-email'" class="login-field">
            <label>邮箱</label>
            <input v-model="loginForm.email" type="email" placeholder="请输入邮箱" required />
          </div>
          <div v-if="loginActiveTab === 'register'" class="login-field">
            <label>邮箱 <span class="optional">(可选)</span></label>
            <input v-model="loginForm.email" type="email" placeholder="请输入邮箱" />
          </div>
          <div class="login-field">
            <label>密码</label>
            <input v-model="loginForm.password" type="password" placeholder="请输入密码" required minlength="6" />
          </div>
          <div v-if="authStore.error" class="login-error">{{ authStore.error }}</div>
          <button type="submit" class="login-submit-btn" :disabled="authStore.loading">
            {{ authStore.loading ? '请稍候...' : loginSubmitLabel }}
          </button>
        </form>
      </div>
    </div>

    <div class="editor-body">
      <Canvas ref="canvasRef" />

      <transition name="slide">
        <StylePanel v-if="uiStore.showStylePanel" />
      </transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMindMapStore } from '@/stores/mindmap'
import { useUIStore } from '@/stores/ui'
import { useAuthStore } from '@/stores/auth'
import Toolbar from './Toolbar.vue'
import Canvas from './Canvas.vue'
import StylePanel from './StylePanel.vue'
import { exportToImage, exportToSVG, exportToMarkdownFile, exportToFMD } from '@/utils/export'
import { stringifyMarkdown } from '@/utils/markdown'

const route = useRoute()
const router = useRouter()
const mindMapStore = useMindMapStore()
const uiStore = useUIStore()
const authStore = useAuthStore()
const canvasRef = ref<InstanceType<typeof Canvas> | null>(null)
const showLoginPrompt = ref(false)

// Login form state
const loginTabs = [
  { id: 'login-user', label: '账号登录' },
  { id: 'login-email', label: '邮箱登录' },
  { id: 'register', label: '注册' },
]
const loginActiveTab = ref('login-user')
const loginForm = ref({ username: '', email: '', password: '' })

const loginSubmitLabel = computed(() => {
  if (loginActiveTab.value === 'register') return '注册'
  return '登录'
})

async function handleLoginSubmit() {
  let success = false
  if (loginActiveTab.value === 'register') {
    success = await authStore.register(loginForm.value.username, loginForm.value.password, loginForm.value.email || undefined)
  } else if (loginActiveTab.value === 'login-email') {
    success = await authStore.login(loginForm.value.email, loginForm.value.password, 'email')
  } else {
    success = await authStore.login(loginForm.value.username, loginForm.value.password, 'username')
  }
  if (success) {
    showLoginPrompt.value = false
  }
}

let initTimer: number | null = null

onMounted(async () => {
  uiStore.loadTheme()

  const id = route.params.id as string
  const loaded = await mindMapStore.loadMap(id)
  if (!loaded) {
    router.push('/dashboard')
    return
  }

  // Check for pending AI prompt from landing page
  const pendingPrompt = sessionStorage.getItem('currentPrompt')
  if (pendingPrompt) {
    sessionStorage.removeItem('currentPrompt')
    sessionStorage.removeItem('mapId')
    await mindMapStore.generateFromAI(pendingPrompt)
  }

  // Force an initial save to generate the thumbnail for the dashboard
  initTimer = window.setTimeout(() => {
    mindMapStore.saveCurrentMap()
  }, 500)

  window.addEventListener('beforeunload', handleBeforeUnload)
})

onUnmounted(() => {
  if (initTimer) window.clearTimeout(initTimer)
  window.removeEventListener('beforeunload', handleBeforeUnload)
})

function handleBeforeUnload(e: BeforeUnloadEvent): void {
  if (mindMapStore.isModified) {
    mindMapStore.saveCurrentMap()
  }
}

function handleExport(format: 'png' | 'jpg'): void {
  if (!requireLogin()) return
  const svgElement = document.querySelector('.mindmap-svg') as SVGElement
  if (svgElement && mindMapStore.currentMap) {
    exportToImage(svgElement, format, mindMapStore.currentMap.name)
  }
}

function handleExportSVG(): void {
  if (!requireLogin()) return
  const svgElement = document.querySelector('.mindmap-svg') as SVGElement
  if (svgElement && mindMapStore.currentMap) {
    exportToSVG(svgElement, mindMapStore.currentMap.name)
  }
}

function handleExportMarkdown(): void {
  if (!requireLogin()) return
  if (mindMapStore.currentMap) {
    const md = stringifyMarkdown(mindMapStore.currentMap.root)
    exportToMarkdownFile(md, mindMapStore.currentMap.name)
  }
}

function handleExportFMD(): void {
  if (!requireLogin()) return
  if (mindMapStore.currentMap) {
    const author = authStore.user?.username
    exportToFMD(mindMapStore.currentMap, mindMapStore.currentMap.name, author)
  }
}

function requireLogin(): boolean {
  if (!authStore.isAuthenticated) {
    authStore.error = null
    showLoginPrompt.value = true
    return false
  }
  return true
}

function handleResetView(): void {
  canvasRef.value?.centerView()
}
</script>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg-primary);
  overflow: hidden;
}

.editor-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
  margin: 12px 16px 12px 16px;
  gap: 16px;
}

.slide-enter-active,
.slide-leave-active {
  transition: width 0.3s ease, margin 0.3s ease, opacity 0.3s ease;
}

.slide-enter-from,
.slide-leave-to {
  width: 0 !important;
  margin-left: 0 !important;
  opacity: 0;
}

.ai-indicator {
  position: absolute;
  bottom: 20px;
  left: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
  color: var(--accent-color);
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  z-index: 100;
  animation: indicatorPulse 2s ease-in-out infinite;
}

.ai-indicator-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent-color);
  animation: dotPulse 1.2s ease-in-out infinite;
}

@keyframes indicatorPulse {
  0%, 100% { box-shadow: 0 4px 12px rgba(139, 92, 246, 0.1); }
  50% { box-shadow: 0 4px 20px rgba(139, 92, 246, 0.25); }
}

@keyframes dotPulse {
  0%, 100% { opacity: 0.4; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.2); }
}

.login-prompt-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(6px);
}

.login-prompt-card {
  background: white;
  border-radius: 20px;
  padding: 36px 32px 28px;
  max-width: 400px;
  width: 90%;
  box-shadow: 0 25px 50px rgba(0,0,0,0.2);
  position: relative;
  animation: loginModalIn 0.25s ease-out;
}

@keyframes loginModalIn {
  from { opacity: 0; transform: translateY(12px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.login-close-btn {
  position: absolute;
  top: 14px;
  right: 14px;
  background: transparent;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  padding: 6px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  transition: all 0.15s;
}

.login-close-btn:hover {
  background: #f1f5f9;
  color: #475569;
}

.login-prompt-header {
  text-align: center;
  margin-bottom: 24px;
}

.login-brand-icon {
  width: 44px;
  height: 44px;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: white;
  margin-bottom: 12px;
  box-shadow: 0 4px 12px rgba(139, 92, 246, 0.25);
}

.login-prompt-header h3 {
  font-size: 20px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 4px;
}

.login-prompt-header p {
  font-size: 14px;
  color: #64748b;
}

.login-tabs {
  display: flex;
  gap: 4px;
  background: #f1f5f9;
  border-radius: 10px;
  padding: 4px;
  margin-bottom: 20px;
}

.login-tab {
  flex: 1;
  padding: 8px 10px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: #64748b;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.login-tab:hover { color: #475569; }

.login-tab.active {
  background: white;
  color: #8b5cf6;
  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.login-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.login-field label {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

.login-field .optional {
  font-weight: 400;
  color: #94a3b8;
}

.login-field input {
  padding: 11px 14px;
  border: 1.5px solid #e2e8f0;
  border-radius: 10px;
  font-size: 14px;
  color: #1e293b;
  outline: none;
  transition: all 0.2s;
  background: #fafbfc;
}

.login-field input:focus {
  border-color: #8b5cf6;
  box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
  background: white;
}

.login-field input::placeholder { color: #94a3b8; }

.login-error {
  background: #fef2f2;
  color: #dc2626;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid #fecaca;
}

.login-submit-btn {
  padding: 12px;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  color: white;
  border: none;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  margin-top: 4px;
  box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
}

.login-submit-btn:hover:not(:disabled) {
  box-shadow: 0 6px 20px rgba(139, 92, 246, 0.4);
  transform: translateY(-1px);
}

.login-submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
