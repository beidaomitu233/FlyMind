<template>
  <div class="login-page">
    <!-- Background with subtle pattern -->
    <div class="login-backdrop"></div>

    <!-- Modal Card -->
    <div class="login-modal">
      <!-- Close button -->
      <button class="close-btn" @click="router.push('/')" title="返回首页">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>

      <!-- Header -->
      <div class="modal-header">
        <div class="brand" @click="router.push('/')">
          <div class="brand-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <circle cx="12" cy="12" r="3"/><line x1="12" y1="5" x2="12" y2="1"/>
              <line x1="12" y1="23" x2="12" y2="19"/><line x1="5" y1="12" x2="1" y2="12"/>
              <line x1="23" y1="12" x2="19" y2="12"/>
            </svg>
          </div>
          <span class="brand-name">FlyMind</span>
        </div>
        <p class="modal-subtitle">登录或注册以继续使用</p>
      </div>

      <!-- OAuth buttons -->
      <div class="oauth-buttons">
        <button class="oauth-btn" @click="loginWithGithub">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
          </svg>
          GitHub 登录
        </button>
        <button class="oauth-btn" @click="loginWithGoogle">
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Google 登录
        </button>
      </div>

      <div class="divider">
        <span>或</span>
      </div>

      <!-- Tabs -->
      <div class="tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="tab"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- Form -->
      <form @submit.prevent="handleSubmit" class="form">
        <div v-if="activeTab === 'register'" class="field">
          <label>用户名</label>
          <input v-model="form.username" type="text" placeholder="请输入用户名" required />
        </div>

        <div v-if="activeTab === 'login-user'" class="field">
          <label>用户名</label>
          <input v-model="form.username" type="text" placeholder="请输入用户名" required />
        </div>

        <div v-if="activeTab === 'login-email'" class="field">
          <label>邮箱</label>
          <input v-model="form.email" type="email" placeholder="请输入邮箱" required />
        </div>

        <div v-if="activeTab === 'register'" class="field">
          <label>邮箱 <span class="optional">(可选)</span></label>
          <input v-model="form.email" type="email" placeholder="请输入邮箱" />
        </div>

        <div class="field">
          <label>密码</label>
          <input v-model="form.password" type="password" placeholder="请输入密码" required minlength="6" />
        </div>

        <div v-if="authStore.error" class="error-msg">{{ authStore.error }}</div>

        <button type="submit" class="submit-btn" :disabled="authStore.loading">
          {{ authStore.loading ? '请稍候...' : submitLabel }}
        </button>
      </form>

      <p class="modal-footer-text">
        继续使用即表示您同意我们的<a href="#">用户协议</a>和<a href="#">隐私政策</a>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const tabs = [
  { id: 'login-user', label: '账号登录' },
  { id: 'login-email', label: '邮箱登录' },
  { id: 'register', label: '注册' },
]

const activeTab = ref('login-user')
const form = ref({ username: '', email: '', password: '' })

const submitLabel = computed(() => {
  if (activeTab.value === 'register') return '注册'
  return '登录'
})

async function handleSubmit() {
  let success = false
  if (activeTab.value === 'register') {
    success = await authStore.register(form.value.username, form.value.password, form.value.email || undefined)
  } else if (activeTab.value === 'login-email') {
    success = await authStore.login(form.value.email, form.value.password, 'email')
  } else {
    success = await authStore.login(form.value.username, form.value.password, 'username')
  }
  if (success) {
    router.push('/dashboard')
  }
}

function loginWithGithub() {
  window.location.href = '/api/auth/oauth/github'
}

function loginWithGoogle() {
  window.location.href = '/api/auth/oauth/google'
}

onMounted(() => {
  const token = route.query.token as string
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      authStore.setTokenFromOAuth(token, {
        id: payload.sub,
        username: 'OAuth User',
      })
      authStore.fetchUser().then(() => {
        router.push('/dashboard')
      })
    } catch {
      // Invalid token
    }
  }
  authStore.init()
  if (authStore.isAuthenticated) {
    router.push('/dashboard')
  }
})
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  padding: 20px;
  background: #f8f9fb;
}

.login-backdrop {
  position: fixed;
  inset: 0;
  background: 
    radial-gradient(ellipse at 20% 50%, rgba(139, 92, 246, 0.06) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 20%, rgba(236, 72, 153, 0.04) 0%, transparent 50%),
    radial-gradient(ellipse at 60% 80%, rgba(59, 130, 246, 0.04) 0%, transparent 50%);
  z-index: 0;
}

.login-modal {
  position: relative;
  z-index: 1;
  background: white;
  border-radius: 20px;
  padding: 40px;
  width: 100%;
  max-width: 420px;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.04),
    0 4px 6px rgba(0, 0, 0, 0.02),
    0 12px 24px rgba(0, 0, 0, 0.06),
    0 24px 48px rgba(0, 0, 0, 0.04);
  animation: modalIn 0.3s ease-out;
}

@keyframes modalIn {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  background: transparent;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  padding: 6px;
  border-radius: 8px;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  background: #f1f5f9;
  color: #475569;
}

.modal-header {
  text-align: center;
  margin-bottom: 28px;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  margin-bottom: 12px;
}

.brand-icon {
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  box-shadow: 0 4px 12px rgba(139, 92, 246, 0.25);
}

.brand-name {
  font-size: 24px;
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -0.5px;
}

.modal-subtitle {
  color: #64748b;
  font-size: 14px;
  margin-top: 4px;
}

/* OAuth */
.oauth-buttons {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
}

.oauth-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 12px;
  border: 1.5px solid #e2e8f0;
  border-radius: 12px;
  background: white;
  color: #334155;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.oauth-btn:hover {
  background: #f8fafc;
  border-color: #8b5cf6;
  box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.06);
}

.divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  color: #94a3b8;
  font-size: 13px;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #e2e8f0;
}

/* Tabs */
.tabs {
  display: flex;
  gap: 4px;
  background: #f1f5f9;
  border-radius: 12px;
  padding: 4px;
  margin-bottom: 20px;
}

.tab {
  flex: 1;
  padding: 9px 12px;
  border-radius: 9px;
  border: none;
  background: transparent;
  color: #64748b;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.tab:hover {
  color: #475569;
}

.tab.active {
  background: white;
  color: #8b5cf6;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

/* Form */
.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field label {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

.field .optional {
  font-weight: 400;
  color: #94a3b8;
}

.field input {
  padding: 12px 14px;
  border: 1.5px solid #e2e8f0;
  border-radius: 12px;
  font-size: 14px;
  color: #1e293b;
  outline: none;
  transition: all 0.2s;
  background: #fafbfc;
}

.field input:focus {
  border-color: #8b5cf6;
  box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
  background: white;
}

.field input::placeholder {
  color: #94a3b8;
}

.error-msg {
  background: #fef2f2;
  color: #dc2626;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid #fecaca;
}

.submit-btn {
  padding: 13px;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  margin-top: 4px;
  box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
}

.submit-btn:hover:not(:disabled) {
  box-shadow: 0 6px 20px rgba(139, 92, 246, 0.4);
  transform: translateY(-1px);
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.modal-footer-text {
  text-align: center;
  font-size: 12px;
  color: #94a3b8;
  margin-top: 24px;
  line-height: 1.5;
}

.modal-footer-text a {
  color: #8b5cf6;
  text-decoration: none;
  font-weight: 500;
}

.modal-footer-text a:hover {
  text-decoration: underline;
}
</style>
