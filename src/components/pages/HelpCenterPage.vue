<template>
  <div class="page-wrapper">
    <nav class="page-nav">
      <router-link to="/" class="back-link">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        返回首页
      </router-link>
    </nav>

    <div class="page-content">
      <div class="page-header">
        <h1>帮助中心</h1>
        <p>查找使用指南、常见问题和解决方案</p>
      </div>

      <!-- Search -->
      <div class="search-box">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索问题或关键词..."
          class="search-input"
        />
      </div>

      <!-- Categories -->
      <div class="category-grid">
        <button
          v-for="cat in categories"
          :key="cat.id"
          class="category-card"
          :class="{ active: activeCategory === cat.id }"
          @click="activeCategory = cat.id"
        >
          <span class="cat-icon">{{ cat.icon }}</span>
          <span class="cat-label">{{ cat.label }}</span>
        </button>
      </div>

      <!-- Quick Start -->
      <div class="section" v-if="activeCategory === 'quickstart'">
        <h2>新手教程</h2>
        <div class="guide-steps">
          <div class="guide-step" v-for="(step, i) in quickStartSteps" :key="i">
            <div class="step-number">{{ i + 1 }}</div>
            <div class="step-content">
              <h3>{{ step.title }}</h3>
              <p>{{ step.desc }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- FAQ -->
      <div class="section" v-if="activeCategory !== 'quickstart'">
        <h2>{{ currentCategoryLabel }}</h2>
        <div class="faq-list">
          <div
            v-for="item in filteredFaqs"
            :key="item.q"
            class="faq-item"
          >
            <div class="faq-q" @click="item.open = !item.open">
              <span>{{ item.q }}</span>
              <svg :class="{ rotated: item.open }" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <div v-if="item.open" class="faq-a">{{ item.a }}</div>
          </div>
          <div v-if="filteredFaqs.length === 0" class="empty-state">
            <p>没有找到相关问题，请尝试其他关键词。</p>
          </div>
        </div>
      </div>

      <!-- User Agreement & Privacy -->
      <div class="section" v-if="activeCategory === 'legal'">
        <div class="legal-card">
          <h3>用户协议</h3>
          <p>使用 FlyMind 即表示您同意以下条款：</p>
          <ul>
            <li>您应合法使用本产品，不得利用其从事违法违规活动。</li>
            <li>您创建的思维导图内容归您所有，我们不会用于其他用途。</li>
            <li>我们保留在服务条款变更时提前通知用户的权利。</li>
            <li>免费版的使用可能受到功能限制，具体以产品页面为准。</li>
          </ul>
        </div>
        <div class="legal-card">
          <h3>隐私政策</h3>
          <p>FlyMind 重视您的隐私保护：</p>
          <ul>
            <li>我们仅收集提供服务所必需的最少信息。</li>
            <li>您的数据使用 AES-256 加密存储，传输使用 TLS 1.3 加密。</li>
            <li>我们不会向第三方出售或共享您的个人数据。</li>
            <li>您可以随时请求导出或删除您的所有数据。</li>
          </ul>
        </div>
      </div>

      <!-- Contact Support -->
      <div class="support-section">
        <h2>没有找到答案？</h2>
        <p>我们的支持团队随时为您提供帮助</p>
        <div class="support-options">
          <div class="support-card">
            <div class="support-icon">📧</div>
            <h4>邮件支持</h4>
            <p>support@flymind.com</p>
            <span class="support-time">通常 24 小时内回复</span>
          </div>
          <div class="support-card">
            <div class="support-icon">💬</div>
            <h4>在线客服</h4>
            <p>工作日 9:00-18:00</p>
            <span class="support-time">即时响应</span>
          </div>
        </div>
      </div>
    </div>

    <footer class="page-footer">
      <span>© 2026 FlyMind</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'

const searchQuery = ref('')
const activeCategory = ref('quickstart')

const categories = [
  { id: 'quickstart', icon: '🚀', label: '新手入门' },
  { id: 'general', icon: '💡', label: '常见问题' },
  { id: 'ai', icon: '🤖', label: 'AI 功能' },
  { id: 'export', icon: '📤', label: '导出分享' },
  { id: 'account', icon: '👤', label: '账号管理' },
  { id: 'legal', icon: '📜', label: '协议政策' },
]

const currentCategoryLabel = computed(() => {
  const cat = categories.find(c => c.id === activeCategory.value)
  return cat ? cat.label : ''
})

const quickStartSteps = [
  { title: '打开 FlyMind', desc: '访问 flymind.com，点击「立即生成」按钮，无需注册即可开始体验。' },
  { title: '输入您的想法', desc: '在首页输入框中输入文字、粘贴网页链接或上传文档，描述您想整理的主题。' },
  { title: 'AI 智能生成', desc: '点击「立即生成」按钮，AI 将在几秒钟内为您生成结构化的思维导图。' },
  { title: '编辑和完善', desc: '使用工具栏添加子主题、同级节点，调整布局和样式，让导图更符合您的需求。' },
  { title: '保存和导出', desc: '完成编辑后，可以通过导出菜单将导图保存为 PNG、SVG、Markdown 或 .fmd 格式。' },
]

interface FaqItem { q: string; a: string; cat: string; open: boolean }

const allFaqs = reactive<FaqItem[]>([
  // General
  { q: 'FlyMind 是什么？', a: 'FlyMind 是一款 AI 驱动的在线思维导图工具，可以帮助您将想法和知识快速结构化为可视化的思维导图。', cat: 'general', open: false },
  { q: '需要注册才能使用吗？', a: '不需要。FlyMind 提供游客模式，您可以直接开始创建思维导图。但注册后可以享受云端存储等更多功能。', cat: 'general', open: false },
  { q: '支持哪些浏览器？', a: '推荐使用 Chrome、Edge、Firefox 或 Safari 最新版本。我们不支持 IE 浏览器。', cat: 'general', open: false },
  { q: '可以在手机上使用吗？', a: '可以。FlyMind 支持响应式设计，在移动端浏览器上也能正常使用，同时支持触控操作。', cat: 'general', open: false },
  // AI
  { q: 'AI 生成的原理是什么？', a: '我们使用先进的大语言模型（如 DeepSeek）分析您的输入，理解主题结构后生成层次化的思维导图节点。', cat: 'ai', open: false },
  { q: '免费版每天可以 AI 生成几次？', a: '免费版每天可以使用 AI 生成 5 次。如需更多次数，可升级到专业版享受无限 AI 生成。', cat: 'ai', open: false },
  { q: 'AI 生成结果不满意怎么办？', a: '您可以手动编辑生成的节点，添加、删除或修改内容。也可以重新描述主题让 AI 重新生成。', cat: 'ai', open: false },
  // Export
  { q: '支持哪些导出格式？', a: '目前支持 PNG（背景透明）、JPG、SVG、Markdown 和 .fmd（FlyMind 专用格式）导出。', cat: 'export', open: false },
  { q: 'PNG 导出有水印吗？', a: '免费版和专业版导出的图片均不带水印，您可以放心使用。', cat: 'export', open: false },
  { q: '什么是 .fmd 文件？', a: '.fmd 是 FlyMind 的专用文件格式（FlyMind Document），以 JSON 格式保存完整的导图数据和样式，方便备份和迁移。', cat: 'export', open: false },
  // Account
  { q: '如何修改密码？', a: '登录后，进入个人中心，点击「账号设置」即可修改密码。', cat: 'account', open: false },
  { q: '忘记密码怎么办？', a: '在登录页面点击「忘记密码」，输入注册邮箱即可收到密码重置链接。', cat: 'account', open: false },
  { q: '如何注销账号？', a: '进入个人中心 → 账号设置 → 注销账号。注销后所有数据将被永久删除，请提前备份。', cat: 'account', open: false },
])

const filteredFaqs = computed(() => {
  let list = allFaqs.filter(f => f.cat === activeCategory.value)
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    list = allFaqs.filter(f => f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q))
  }
  return list
})
</script>

<style scoped>
.page-wrapper {
  min-height: 100vh;
  background: #f8f9fb;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.page-nav {
  padding: 20px 24px;
  max-width: 900px;
  margin: 0 auto;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #64748b;
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  transition: color 0.2s;
}

.back-link:hover { color: #8b5cf6; }

.page-content {
  max-width: 900px;
  margin: 0 auto;
  padding: 0 24px 80px;
}

.page-header {
  text-align: center;
  margin-bottom: 40px;
}

.page-header h1 {
  font-size: 40px;
  font-weight: 800;
  color: #0f172a;
  margin-bottom: 12px;
  letter-spacing: -1px;
}

.page-header p {
  font-size: 18px;
  color: #64748b;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 12px;
  background: white;
  border: 1.5px solid #e2e8f0;
  border-radius: 14px;
  padding: 14px 20px;
  margin-bottom: 32px;
  transition: border-color 0.2s;
}

.search-box:focus-within { border-color: #8b5cf6; box-shadow: 0 0 0 3px rgba(139,92,246,0.08); }

.search-box svg { color: #94a3b8; flex-shrink: 0; }

.search-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 15px;
  color: #1e293b;
  background: transparent;
}

.search-input::placeholder { color: #94a3b8; }

.category-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 48px;
}

@media (min-width: 640px) { .category-grid { grid-template-columns: repeat(6, 1fr); } }

.category-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 16px 8px;
  background: white;
  border: 1.5px solid #e2e8f0;
  border-radius: 14px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 13px;
  font-weight: 600;
  color: #475569;
}

.category-card:hover { border-color: #8b5cf6; transform: translateY(-2px); }

.category-card.active {
  border-color: #8b5cf6;
  background: #f5f3ff;
  color: #7c3aed;
}

.cat-icon { font-size: 24px; }
.cat-label { font-size: 12px; text-align: center; }

.section { margin-bottom: 48px; }

.section h2 {
  font-size: 24px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 24px;
}

.guide-steps {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.guide-step {
  display: flex;
  gap: 16px;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 24px;
  transition: all 0.2s;
}

.guide-step:hover { border-color: #8b5cf6; box-shadow: 0 4px 16px rgba(0,0,0,0.04); }

.step-number {
  width: 36px;
  height: 36px;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  color: white;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 800;
  flex-shrink: 0;
}

.step-content h3 {
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 6px;
}

.step-content p {
  font-size: 14px;
  color: #64748b;
  line-height: 1.6;
}

.faq-list { display: flex; flex-direction: column; gap: 12px; }

.faq-item {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.2s;
}

.faq-item:hover { border-color: #8b5cf6; }

.faq-q {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  cursor: pointer;
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
}

.faq-q svg { color: #94a3b8; transition: transform 0.2s; flex-shrink: 0; }
.faq-q svg.rotated { transform: rotate(180deg); }

.faq-a {
  padding: 0 20px 16px;
  font-size: 14px;
  color: #64748b;
  line-height: 1.6;
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: #94a3b8;
}

.legal-card {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 28px;
  margin-bottom: 20px;
}

.legal-card h3 {
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 12px;
}

.legal-card p {
  font-size: 14px;
  color: #64748b;
  margin-bottom: 12px;
}

.legal-card ul {
  list-style: disc;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.legal-card ul li {
  font-size: 14px;
  color: #475569;
  line-height: 1.6;
}

.support-section {
  text-align: center;
  padding: 48px 0;
  border-top: 1px solid #e2e8f0;
  margin-top: 48px;
}

.support-section h2 {
  font-size: 24px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 8px;
}

.support-section > p {
  font-size: 15px;
  color: #64748b;
  margin-bottom: 32px;
}

.support-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  max-width: 500px;
  margin: 0 auto;
}

@media (max-width: 500px) { .support-options { grid-template-columns: 1fr; } }

.support-card {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 28px;
  transition: all 0.2s;
}

.support-card:hover { border-color: #8b5cf6; transform: translateY(-2px); }

.support-icon { font-size: 32px; margin-bottom: 12px; }

.support-card h4 {
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 4px;
}

.support-card p {
  font-size: 14px;
  color: #8b5cf6;
  font-weight: 500;
  margin-bottom: 4px;
}

.support-time {
  font-size: 12px;
  color: #94a3b8;
}

.page-footer {
  text-align: center;
  padding: 24px;
  font-size: 13px;
  color: #94a3b8;
  border-top: 1px solid #e2e8f0;
}
</style>
