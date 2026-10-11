import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface AuthUser {
  id: string
  username: string
  email?: string | null
  avatar_url?: string | null
}

const TOKEN_KEY = 'flymind_token'
const USER_KEY = 'flymind_user'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(null)
  const user = ref<AuthUser | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const isAuthenticated = computed(() => !!token.value)

  // ── Init: restore from localStorage ───────────────
  function init() {
    try {
      const savedToken = localStorage.getItem(TOKEN_KEY)
      const savedUser = localStorage.getItem(USER_KEY)
      if (savedToken) token.value = savedToken
      if (savedUser) user.value = JSON.parse(savedUser)
    } catch {
      // ignore
    }
  }

  function _persist() {
    try {
      if (token.value) localStorage.setItem(TOKEN_KEY, token.value)
      else localStorage.removeItem(TOKEN_KEY)
      if (user.value) localStorage.setItem(USER_KEY, JSON.stringify(user.value))
      else localStorage.removeItem(USER_KEY)
    } catch {
      // ignore
    }
  }

  // ── Helpers ────────────────────────────────────────
  function _authHeaders(): HeadersInit {
    const headers: HeadersInit = { 'Content-Type': 'application/json' }
    if (token.value) headers['Authorization'] = `Bearer ${token.value}`
    return headers
  }

  // ── Register ───────────────────────────────────────
  async function register(username: string, password: string, email?: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, email: email || null }),
      })
      if (!res.ok) {
        try {
          const data = await res.json()
          error.value = data.detail || 'Registration failed'
        } catch {
          const text = await res.text().catch(() => '')
          error.value = text || `Registration failed (${res.status})`
        }
        return false
      }
      const data = await res.json()
      token.value = data.token
      user.value = data.user
      _persist()
      return true
    } catch (e: any) {
      error.value = e.message || 'Network error'
      return false
    } finally {
      loading.value = false
    }
  }

  // ── Login ──────────────────────────────────────────
  async function login(
    identifier: string,
    password: string,
    mode: 'username' | 'email' = 'username'
  ): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      const body = mode === 'email'
        ? { email: identifier, password }
        : { username: identifier, password }
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        try {
          const data = await res.json()
          error.value = data.detail || 'Login failed'
        } catch {
          const text = await res.text().catch(() => '')
          error.value = text || `Login failed (${res.status})`
        }
        return false
      }
      const data = await res.json()
      token.value = data.token
      user.value = data.user
      _persist()
      return true
    } catch (e: any) {
      error.value = e.message || 'Network error'
      return false
    } finally {
      loading.value = false
    }
  }

  // ── Handle OAuth callback token ────────────────────
  function setTokenFromOAuth(jwtToken: string, userData: AuthUser) {
    token.value = jwtToken
    user.value = userData
    _persist()
  }

  // ── Fetch current user ─────────────────────────────
  async function fetchUser(): Promise<void> {
    if (!token.value) return
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token.value}` },
      })
      if (res.ok) {
        user.value = await res.json()
        _persist()
      } else {
        // Token expired or invalid
        logout()
      }
    } catch {
      // ignore
    }
  }

  // ── Logout ─────────────────────────────────────────
  function logout() {
    token.value = null
    user.value = null
    _persist()
  }

  // ── Auth header for API calls ──────────────────────
  function authHeaders(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token.value) h['Authorization'] = `Bearer ${token.value}`
    return h
  }

  return {
    token,
    user,
    loading,
    error,
    isAuthenticated,
    init,
    register,
    login,
    logout,
    fetchUser,
    setTokenFromOAuth,
    authHeaders,
  }
})
