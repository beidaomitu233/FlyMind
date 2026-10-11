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
        <h1>定价方案</h1>
        <p>选择适合您的方案，随时升级或降级</p>
      </div>

      <div class="pricing-grid">
        <!-- Free Plan -->
        <div class="pricing-card">
          <div class="plan-badge free">免费版</div>
          <div class="plan-price">¥0<span>/月</span></div>
          <p class="plan-desc">适合个人试用和轻度用户</p>
          <ul class="plan-features">
            <li><span class="check">✓</span> 无限创建思维导图</li>
            <li><span class="check">✓</span> AI 生成（每日 5 次）</li>
            <li><span class="check">✓</span> 导出 PNG / JPG / SVG</li>
            <li><span class="check">✓</span> 导出 Markdown / .fmd</li>
            <li><span class="check">✓</span> 基础主题和布局</li>
            <li><span class="check muted">—</span> 云端存储 100 MB</li>
          </ul>
          <button class="plan-btn current" disabled>当前方案</button>
        </div>

        <!-- Pro Plan -->
        <div class="pricing-card featured">
          <div class="plan-badge pro">专业版</div>
          <div class="popular-tag">最受欢迎</div>
          <div class="plan-price">¥29<span>/月</span></div>
          <p class="plan-desc">适合专业人士和重度用户</p>
          <ul class="plan-features">
            <li><span class="check">✓</span> 无限创建思维导图</li>
            <li><span class="check">✓</span> AI 生成（无限次）</li>
            <li><span class="check">✓</span> 全部导出格式</li>
            <li><span class="check">✓</span> 高级主题和自定义样式</li>
            <li><span class="check">✓</span> 实时协作（最多 5 人）</li>
            <li><span class="check">✓</span> 云端存储 10 GB</li>
            <li><span class="check">✓</span> 版本历史记录</li>
          </ul>
          <button class="plan-btn primary">升级到专业版</button>
        </div>

        <!-- Team Plan -->
        <div class="pricing-card">
          <div class="plan-badge team">团队版</div>
          <div class="plan-price">¥99<span>/月</span></div>
          <p class="plan-desc">适合团队协作和企业使用</p>
          <ul class="plan-features">
            <li><span class="check">✓</span> 专业版全部功能</li>
            <li><span class="check">✓</span> 无限协作成员</li>
            <li><span class="check">✓</span> 团队管理和权限控制</li>
            <li><span class="check">✓</span> 云端存储 100 GB</li>
            <li><span class="check">✓</span> 优先技术支持</li>
            <li><span class="check">✓</span> API 接口访问</li>
            <li><span class="check">✓</span> 自定义品牌水印</li>
          </ul>
          <button class="plan-btn">联系销售</button>
        </div>
      </div>

      <div class="faq-section">
        <h2>常见问题</h2>
        <div class="faq-list">
          <div class="faq-item" v-for="item in faqs" :key="item.q">
            <div class="faq-q" @click="item.open = !item.open">
              <span>{{ item.q }}</span>
              <svg :class="{ rotated: item.open }" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <div v-if="item.open" class="faq-a">{{ item.a }}</div>
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
import { reactive } from 'vue'

const faqs = reactive([
  { q: '免费版有什么限制？', a: '免费版可以无限创建思维导图，但 AI 生成每日限 5 次，云端存储空间为 100 MB。所有导出功能均可使用。', open: false },
  { q: '可以随时取消订阅吗？', a: '当然可以。您可以随时取消订阅，取消后将在当前计费周期结束时降级为免费版。', open: false },
  { q: '支持哪些支付方式？', a: '目前支持微信支付、支付宝和银行卡支付。团队版还支持对公转账。', open: false },
  { q: '数据安全如何保障？', a: '所有数据均使用 AES-256 加密存储，传输过程使用 TLS 1.3 加密。我们通过了 ISO 27001 安全认证。', open: false },
])
</script>

<style scoped>
.page-wrapper {
  min-height: 100vh;
  background: #f8f9fb;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.page-nav {
  padding: 20px 24px;
  max-width: 1200px;
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
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px 80px;
}

.page-header {
  text-align: center;
  margin-bottom: 64px;
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

.pricing-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;
  max-width: 1000px;
  margin: 0 auto;
}

@media (min-width: 768px) { .pricing-grid { grid-template-columns: repeat(3, 1fr); } }

.pricing-card {
  background: white;
  border-radius: 20px;
  padding: 32px;
  border: 1.5px solid #e2e8f0;
  position: relative;
  transition: all 0.3s;
}

.pricing-card:hover { transform: translateY(-4px); box-shadow: 0 12px 32px rgba(0,0,0,0.08); }

.pricing-card.featured {
  border-color: #8b5cf6;
  box-shadow: 0 8px 32px rgba(139, 92, 246, 0.15);
}

.popular-tag {
  position: absolute;
  top: -12px;
  left: 50%;
  transform: translateX(-50%);
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  color: white;
  padding: 4px 16px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.plan-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 16px;
}

.plan-badge.free { background: #f1f5f9; color: #475569; }
.plan-badge.pro { background: #f5f3ff; color: #7c3aed; }
.plan-badge.team { background: #eff6ff; color: #2563eb; }

.plan-price {
  font-size: 48px;
  font-weight: 800;
  color: #0f172a;
  margin-bottom: 8px;
  letter-spacing: -2px;
}

.plan-price span {
  font-size: 16px;
  font-weight: 500;
  color: #94a3b8;
  letter-spacing: 0;
}

.plan-desc {
  font-size: 14px;
  color: #64748b;
  margin-bottom: 24px;
}

.plan-features {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 32px;
}

.plan-features li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #334155;
}

.check {
  color: #22c55e;
  font-weight: 700;
  flex-shrink: 0;
}

.check.muted { color: #94a3b8; }

.plan-btn {
  width: 100%;
  padding: 12px;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  border: 1.5px solid #e2e8f0;
  background: white;
  color: #334155;
}

.plan-btn:hover:not(:disabled) { border-color: #8b5cf6; color: #8b5cf6; }

.plan-btn.primary {
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  color: white;
  border: none;
  box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
}

.plan-btn.primary:hover { box-shadow: 0 6px 20px rgba(139, 92, 246, 0.4); transform: translateY(-1px); }

.plan-btn.current { opacity: 0.5; cursor: default; }

.faq-section {
  max-width: 700px;
  margin: 80px auto 0;
}

.faq-section h2 {
  font-size: 28px;
  font-weight: 700;
  color: #0f172a;
  text-align: center;
  margin-bottom: 32px;
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

.page-footer {
  text-align: center;
  padding: 24px;
  font-size: 13px;
  color: #94a3b8;
  border-top: 1px solid #e2e8f0;
}
</style>
