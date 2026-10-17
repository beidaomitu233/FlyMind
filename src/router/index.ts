import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/native',
      name: 'native-studio',
      component: () => import('@/drawing/ui/NativeStudio.vue')
    },
    {
      path: '/',
      name: 'drawing-studio',
      component: () => import('@/drawing/ui/Studio.vue')
    },
    {
      path: '/legacy',
      name: 'landing',
      component: () => import('@/components/landing/LandingPage.vue')
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/components/auth/LoginPage.vue')
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('@/components/dashboard/Dashboard.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/editor/:id',
      name: 'editor',
      component: () => import('@/components/editor/Editor.vue'),
      // Guest mode: allow unauthenticated access
    },
    {
      path: '/pricing',
      name: 'pricing',
      component: () => import('@/components/pages/PricingPage.vue')
    },
    {
      path: '/about',
      name: 'about',
      component: () => import('@/components/pages/AboutPage.vue')
    },
    {
      path: '/help',
      name: 'help',
      component: () => import('@/components/pages/HelpCenterPage.vue')
    }
  ],
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition
    if (to.hash) return { el: to.hash, behavior: 'smooth' }
    return { top: 0 }
  }
})

// Route guard: redirect to login if auth required
router.beforeEach((to, from, next) => {
  const authStore = useAuthStore()
  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    next({ path: '/login', query: { redirect: to.fullPath } })
  } else if (to.path === '/login' && authStore.isAuthenticated) {
    next('/dashboard')
  } else {
    next()
  }
})

export default router
