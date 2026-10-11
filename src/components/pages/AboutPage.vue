<template>
  <div class="page-wrapper">
    <nav class="page-nav">
      <router-link to="/" class="back-link">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        返回首页
      </router-link>
    </nav>

    <div class="page-content">
      <div class="about-hero">
        <div class="about-logo">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/><line x1="12" y1="5" x2="12" y2="1"/><line x1="12" y1="23" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="1" y2="12"/><line x1="23" y1="12" x2="19" y2="12"/>
          </svg>
        </div>
        <h1>关于 FlyMind</h1>
        <p class="about-tagline">让思维可视化，让知识有结构</p>
        <p class="about-desc">
          FlyMind 是一款 AI 驱动的在线思维导图工具。我们致力于帮助用户将碎片化的想法和知识，
          通过智能技术瞬间织就成脉络清晰的知识网格，让每个人都能更高效地思考和创造。
        </p>
      </div>

      <div class="about-section">
        <h2>我们的故事</h2>
        <p>
          在信息爆炸的时代，人们每天面对海量知识却难以消化整理。FlyMind 诞生于 2024 年，
          由一群热爱思维导图和 AI 技术的开发者创立。我们希望将 AI 的力量与人类的结构化思维相结合，
          打造一款真正智能、好用的知识管理工具。
        </p>
        <p>
          从最初的简单原型到如今服务数万用户，FlyMind 一直在倾听社区的声音，不断迭代优化。
          我们相信，好的工具应该让用户忘记工具本身，专注于思考。
        </p>
      </div>

      <div class="values-grid">
        <div class="value-card" v-for="item in values" :key="item.title">
          <div class="value-icon">{{ item.icon }}</div>
          <h3>{{ item.title }}</h3>
          <p>{{ item.desc }}</p>
        </div>
      </div>

      <div class="about-section">
        <h2>技术团队</h2>
        <p>
          我们的团队由来自人工智能、产品设计和前端工程领域的专业人才组成。
          团队成员来自清华大学、浙江大学等知名高校，拥有丰富的互联网产品研发经验。
          我们采用前沿的 Web 技术栈（Vue 3、TypeScript、FastAPI），
          确保产品的性能、安全性和可扩展性。
        </p>
      </div>

      <div class="about-section contact-section">
        <h2>联系我们</h2>
        <div class="contact-grid">
          <div class="contact-item">
            <span class="contact-label">客服邮箱</span>
            <span class="contact-value">support@flymind.com</span>
          </div>
          <div class="contact-item">
            <span class="contact-label">商务合作</span>
            <span class="contact-value">biz@flymind.com</span>
          </div>
          <div class="contact-item">
            <span class="contact-label">技术反馈</span>
            <span class="contact-value">dev@flymind.com</span>
          </div>
        </div>
      </div>

      <div class="changelog-section">
        <h2>更新历史</h2>
        <div class="changelog-list">
          <div class="changelog-item" v-for="item in changelog" :key="item.date">
            <div class="changelog-date">{{ item.date }}</div>
            <div class="changelog-badge" :class="item.type">{{ item.typeLabel }}</div>
            <div class="changelog-text">{{ item.text }}</div>
          </div>
        </div>
      </div>
    </div>

    <footer class="page-footer">
      <span>© 2026 FlyMind 版权所有</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
const values = [
  { icon: '🧠', title: '智能驱动', desc: '深度集成 AI 技术，让思维导图的创建变得更智能、更高效。' },
  { icon: '🎨', title: '设计优先', desc: '注重用户体验和视觉美感，让每次使用都是一种享受。' },
  { icon: '🔒', title: '隐私安全', desc: '数据加密存储和传输，尊重并保护用户的每一份数据。' },
  { icon: '🌍', title: '开放包容', desc: '支持多种文件格式导入导出，让知识自由流动。' },
]

const changelog = [
  { date: '2026-06', type: 'feature', typeLabel: '新功能', text: '全新 AI 生成引擎，支持流式输出，生成速度提升 3 倍' },
  { date: '2026-05', type: 'improve', typeLabel: '优化', text: '优化移动端适配，支持触控操作和响应式布局' },
  { date: '2026-04', type: 'feature', typeLabel: '新功能', text: '新增 .fmd 文件格式，支持完整保存导图数据和样式' },
  { date: '2026-03', type: 'fix', typeLabel: '修复', text: '修复大量节点时画布渲染卡顿的性能问题' },
  { date: '2026-02', type: 'feature', typeLabel: '新功能', text: '上线游客模式，无需注册即可快速体验' },
  { date: '2026-01', type: 'improve', typeLabel: '优化', text: '全新设计的样式面板，新增 8 套主题配色' },
]
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

.about-hero {
  text-align: center;
  margin-bottom: 64px;
}

.about-logo {
  width: 72px;
  height: 72px;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  border-radius: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: white;
  margin-bottom: 20px;
  box-shadow: 0 8px 24px rgba(139, 92, 246, 0.25);
}

.about-hero h1 {
  font-size: 40px;
  font-weight: 800;
  color: #0f172a;
  margin-bottom: 12px;
  letter-spacing: -1px;
}

.about-tagline {
  font-size: 20px;
  color: #8b5cf6;
  font-weight: 600;
  margin-bottom: 16px;
}

.about-desc {
  font-size: 16px;
  color: #64748b;
  line-height: 1.7;
  max-width: 600px;
  margin: 0 auto;
}

.about-section {
  margin-bottom: 48px;
}

.about-section h2 {
  font-size: 24px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 16px;
}

.about-section p {
  font-size: 15px;
  color: #475569;
  line-height: 1.8;
  margin-bottom: 12px;
}

.values-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 64px;
}

@media (max-width: 640px) { .values-grid { grid-template-columns: 1fr; } }

.value-card {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  padding: 28px;
  transition: all 0.2s;
}

.value-card:hover { border-color: #8b5cf6; transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.06); }

.value-icon {
  font-size: 28px;
  margin-bottom: 12px;
}

.value-card h3 {
  font-size: 17px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 8px;
}

.value-card p {
  font-size: 14px;
  color: #64748b;
  line-height: 1.6;
}

.contact-section {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  padding: 32px;
}

.contact-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 16px;
}

.contact-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid #f1f5f9;
}

.contact-item:last-child { border-bottom: none; }

.contact-label {
  font-size: 14px;
  font-weight: 600;
  color: #374151;
}

.contact-value {
  font-size: 14px;
  color: #8b5cf6;
  font-weight: 500;
}

.changelog-section {
  margin-top: 64px;
}

.changelog-section h2 {
  font-size: 24px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 24px;
}

.changelog-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.changelog-item {
  display: flex;
  align-items: center;
  gap: 12px;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 16px 20px;
}

.changelog-date {
  font-size: 13px;
  color: #94a3b8;
  font-weight: 600;
  min-width: 72px;
  flex-shrink: 0;
}

.changelog-badge {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

.changelog-badge.feature { background: #f5f3ff; color: #7c3aed; }
.changelog-badge.improve { background: #eff6ff; color: #2563eb; }
.changelog-badge.fix { background: #fef3c7; color: #d97706; }

.changelog-text {
  font-size: 14px;
  color: #334155;
}

.page-footer {
  text-align: center;
  padding: 24px;
  font-size: 13px;
  color: #94a3b8;
  border-top: 1px solid #e2e8f0;
}
</style>
