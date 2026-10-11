<template>
  <div class="landing-page">
    <!-- NavBar -->
    <nav class="navbar" :class="{ scrolled }">
      <div class="nav-inner">
        <div class="nav-left">
          <router-link to="/" class="logo-link">
            <div class="logo-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <circle cx="12" cy="12" r="3"/><line x1="12" y1="5" x2="12" y2="1"/><line x1="12" y1="23" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="1" y2="12"/><line x1="23" y1="12" x2="19" y2="12"/>
                <line x1="7.05" y1="7.05" x2="4.22" y2="4.22"/><line x1="19.78" y1="19.78" x2="16.95" y2="16.95"/>
                <line x1="7.05" y1="16.95" x2="4.22" y2="19.78"/><line x1="19.78" y1="4.22" x2="16.95" y2="7.05"/>
              </svg>
            </div>
            <span class="logo-text">FlyMind</span>
          </router-link>
          <div class="nav-links">
            <a href="#" @click.prevent="scrollToFeatures" class="nav-link">功能</a>
            <router-link to="/pricing" class="nav-link">定价</router-link>
            <router-link to="/help" class="nav-link">帮助中心</router-link>
            <router-link to="/about" class="nav-link">关于</router-link>
          </div>
        </div>
        <div class="nav-right">
          <router-link to="/login" class="btn-login">开始使用</router-link>
        </div>
        <button class="mobile-menu-btn" @click="mobileOpen = !mobileOpen">
          <svg v-if="!mobileOpen" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          <svg v-else width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <!-- Mobile menu -->
      <div v-if="mobileOpen" class="mobile-menu">
        <a href="#" @click.prevent="scrollToFeatures" class="mobile-link" @click="mobileOpen = false">功能</a>
        <router-link to="/pricing" class="mobile-link" @click="mobileOpen = false">定价</router-link>
        <router-link to="/help" class="mobile-link" @click="mobileOpen = false">帮助中心</router-link>
        <router-link to="/about" class="mobile-link" @click="mobileOpen = false">关于</router-link>
        <router-link to="/login" class="mobile-link btn-mobile-login" @click="mobileOpen = false">开始使用</router-link>
      </div>
    </nav>

    <!-- Hero Section -->
    <section class="hero-section">
      <div class="hero-content">
        <div class="badge">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z"/></svg>
          <span>搭载大模型技术驱动</span>
        </div>

        <h1 class="hero-title">
          结构化思考的<br />
          <span class="gradient-text">智能演进</span>
        </h1>

        <p class="hero-desc">
          通过 AI 将碎片化的灵感、长文本资料甚至是音视频，瞬间织就成脉络清晰的知识网格。
        </p>

        <div class="no-register-badge">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          无需注册，即可快速试用
        </div>

        <!-- Input Card -->
        <div class="input-card">
          <div class="input-tabs">
            <button
              v-for="tab in inputTabs"
              :key="tab.id"
              class="tab-btn"
              :class="{ active: activeTab === tab.id }"
              @click="handleTabClick(tab.id)"
            >
              {{ tab.label }}
            </button>
          </div>

          <!-- Textarea tab -->
          <div v-if="activeTab === 'text'" class="input-area">
            <textarea
              v-model="inputValue"
              rows="3"
              placeholder="输入你的想法，例如：帮我整理一份关于人工智能的学习路线"
              class="hero-textarea"
              @keydown="handleKeyDown"
            ></textarea>
          </div>

          <!-- URL tab -->
          <div v-else-if="activeTab === 'url'" class="input-area">
            <input
              v-model="urlInput"
              type="url"
              placeholder="请输入网页链接，例如：https://example.com/article"
              class="hero-url-input"
              @keydown="(e: KeyboardEvent) => { if (e.key === 'Enter') handleGenerate() }"
            />
          </div>

          <!-- Document tab -->
          <div v-else-if="activeTab === 'document'" class="input-area">
            <div
              class="upload-zone"
              :class="{ dragging: isDragging }"
              @dragover.prevent="isDragging = true"
              @dragleave="isDragging = false"
              @drop.prevent="handleDrop"
              @click="triggerFileInput"
            >
              <input ref="fileInputRef" type="file" class="hidden-input" accept=".pdf,.doc,.docx,.txt,.md,.jpg,.jpeg,.png,.webp" @change="handleFileChange" />
              <div v-if="uploadedFile" class="file-info">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <div>
                  <p class="file-name-text">{{ uploadedFile.name }}</p>
                  <p class="file-size-text">{{ (uploadedFile.size / 1024 / 1024).toFixed(2) }} MB</p>
                </div>
                <button class="remove-file-btn" @click.stop="uploadedFile = null">移除</button>
              </div>
              <div v-else class="upload-placeholder">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <p class="upload-hint">将文档或图片拖拽到此处，或点击上传</p>
                <p class="upload-formats">支持 PDF、Word、TXT、Markdown、JPG/PNG/WebP 图片，文件不超过 20MB</p>
              </div>
            </div>
          </div>

          <div class="input-footer">
            <span class="shortcut-hint">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M6 16h8"/></svg>
              按 Enter 快速生成
            </span>
            <button class="generate-btn" @click="handleGenerate">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M15 9a6 6 0 00-6 6c0 1.66.68 3.16 1.76 4.24"/></svg>
              立即生成
            </button>
          </div>
        </div>

        <!-- Examples -->
        <div class="examples">
          <span class="examples-label">示例：</span>
          <button
            v-for="example in examples"
            :key="example.text"
            class="example-btn"
            @click="handleExampleClick(example.text)"
          >
            {{ example.text }}
          </button>
        </div>
      </div>
    </section>

    <!-- Demo Preview - Animated Mind Map -->
    <section class="demo-section">
      <div class="demo-preview">
        <svg class="demo-mindmap-svg" viewBox="0 0 800 450" xmlns="http://www.w3.org/2000/svg">
          <!-- Connections -->
          <g class="demo-connections" opacity="0.6">
            <line class="conn c1" x1="400" y1="225" x2="230" y2="130" stroke="#8b5cf6" stroke-width="2.5" stroke-linecap="round"/>
            <line class="conn c2" x1="400" y1="225" x2="570" y2="130" stroke="#ec4899" stroke-width="2.5" stroke-linecap="round"/>
            <line class="conn c3" x1="400" y1="225" x2="230" y2="320" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round"/>
            <line class="conn c4" x1="400" y1="225" x2="570" y2="320" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round"/>
            <line class="conn c5" x1="230" y1="130" x2="120" y2="80" stroke="#8b5cf6" stroke-width="1.5" stroke-linecap="round"/>
            <line class="conn c6" x1="230" y1="130" x2="120" y2="160" stroke="#8b5cf6" stroke-width="1.5" stroke-linecap="round"/>
            <line class="conn c7" x1="570" y1="130" x2="680" y2="80" stroke="#ec4899" stroke-width="1.5" stroke-linecap="round"/>
            <line class="conn c8" x1="570" y1="130" x2="680" y2="160" stroke="#ec4899" stroke-width="1.5" stroke-linecap="round"/>
            <line class="conn c9" x1="230" y1="320" x2="120" y2="290" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round"/>
            <line class="conn c10" x1="230" y1="320" x2="120" y2="360" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round"/>
            <line class="conn c11" x1="570" y1="320" x2="680" y2="290" stroke="#22c55e" stroke-width="1.5" stroke-linecap="round"/>
            <line class="conn c12" x1="570" y1="320" x2="680" y2="360" stroke="#22c55e" stroke-width="1.5" stroke-linecap="round"/>
          </g>
          <!-- Nodes -->
          <g class="demo-nodes">
            <!-- Center -->
            <g class="node n0">
              <rect x="340" y="200" width="120" height="50" rx="12" fill="#8b5cf6" opacity="0.9"/>
              <text x="400" y="230" text-anchor="middle" fill="white" font-size="14" font-weight="600">AI 思维导图</text>
            </g>
            <!-- Level 1 -->
            <g class="node n1">
              <rect x="175" y="110" width="110" height="40" rx="10" fill="#8b5cf6" opacity="0.15"/>
              <text x="230" y="135" text-anchor="middle" fill="#6d28d9" font-size="12" font-weight="500">数据收集</text>
            </g>
            <g class="node n2">
              <rect x="515" y="110" width="110" height="40" rx="10" fill="#ec4899" opacity="0.15"/>
              <text x="570" y="135" text-anchor="middle" fill="#be185d" font-size="12" font-weight="500">分析整理</text>
            </g>
            <g class="node n3">
              <rect x="175" y="300" width="110" height="40" rx="10" fill="#f59e0b" opacity="0.15"/>
              <text x="230" y="325" text-anchor="middle" fill="#b45309" font-size="12" font-weight="500">创意发想</text>
            </g>
            <g class="node n4">
              <rect x="515" y="300" width="110" height="40" rx="10" fill="#22c55e" opacity="0.15"/>
              <text x="570" y="325" text-anchor="middle" fill="#15803d" font-size="12" font-weight="500">输出成果</text>
            </g>
            <!-- Level 2 -->
            <g class="node n5">
              <rect x="70" y="65" width="100" height="30" rx="8" fill="#8b5cf6" opacity="0.08"/>
              <text x="120" y="84" text-anchor="middle" fill="#7c3aed" font-size="10">问卷调查</text>
            </g>
            <g class="node n6">
              <rect x="70" y="145" width="100" height="30" rx="8" fill="#8b5cf6" opacity="0.08"/>
              <text x="120" y="164" text-anchor="middle" fill="#7c3aed" font-size="10">文献查阅</text>
            </g>
            <g class="node n7">
              <rect x="630" y="65" width="100" height="30" rx="8" fill="#ec4899" opacity="0.08"/>
              <text x="680" y="84" text-anchor="middle" fill="#db2777" font-size="10">分类归纳</text>
            </g>
            <g class="node n8">
              <rect x="630" y="145" width="100" height="30" rx="8" fill="#ec4899" opacity="0.08"/>
              <text x="680" y="164" text-anchor="middle" fill="#db2777" font-size="10">关系梳理</text>
            </g>
            <g class="node n9">
              <rect x="70" y="275" width="100" height="30" rx="8" fill="#f59e0b" opacity="0.08"/>
              <text x="120" y="294" text-anchor="middle" fill="#d97706" font-size="10">头脑风暴</text>
            </g>
            <g class="node n10">
              <rect x="70" y="345" width="100" height="30" rx="8" fill="#f59e0b" opacity="0.08"/>
              <text x="120" y="364" text-anchor="middle" fill="#d97706" font-size="10">联想拓展</text>
            </g>
            <g class="node n11">
              <rect x="630" y="275" width="100" height="30" rx="8" fill="#22c55e" opacity="0.08"/>
              <text x="680" y="294" text-anchor="middle" fill="#16a34a" font-size="10">演示报告</text>
            </g>
            <g class="node n12">
              <rect x="630" y="345" width="100" height="30" rx="8" fill="#22c55e" opacity="0.08"/>
              <text x="680" y="364" text-anchor="middle" fill="#16a34a" font-size="10">分享协作</text>
            </g>
          </g>
        </svg>
      </div>
    </section>

    <!-- Stats Section -->
    <section class="stats-section">
      <div class="stats-grid">
        <div class="stat-item">
          <span class="stat-number">50,000+</span>
          <span class="stat-label">用户信赖</span>
        </div>
        <div class="stat-item">
          <span class="stat-number">200,000+</span>
          <span class="stat-label">导图已创建</span>
        </div>
        <div class="stat-item">
          <span class="stat-number">99.9%</span>
          <span class="stat-label">服务可用</span>
        </div>
        <div class="stat-item">
          <span class="stat-number">3 秒</span>
          <span class="stat-label">AI 生成速度</span>
        </div>
      </div>
    </section>

    <!-- Feature Cards -->
    <section class="feature-cards-section" id="features">
      <div class="section-header">
        <h2>AI 助理，思维导图更智能</h2>
        <p>有了 AI，您可以轻松生成思维导图，学习工作毫不费力</p>
      </div>

      <div class="feature-cards-grid">
        <div class="feature-card card-indigo">
          <div class="card-preview">
            <div class="ai-prompt-demo">
              <span class="ai-icon">🤖</span>
              <span>生成水浒传读书笔记</span>
              <span class="ai-send">📤</span>
            </div>
          </div>
          <h3><span class="card-tag">AI生成</span> <span class="divider">|</span> 思维导图触手可及</h3>
          <p>借助AI，可以输入一句话，直接生成以此为中心主题的文件，瞬间将想法结构化。</p>
        </div>

        <div class="feature-card card-amber">
          <div class="card-preview">
            <div class="file-types-demo">
              <div class="file-badge pdf">PDF</div>
              <div class="file-badge word">Word</div>
              <div class="file-badge ppt">PPT</div>
            </div>
          </div>
          <h3><span class="card-tag">AI总结</span> <span class="divider">|</span> 思维导图更清晰</h3>
          <p>借助AI，导入论文、财报、小说等，实现无缝快速的内容总结，提取核心脉络。</p>
        </div>

        <div class="feature-card card-cyan">
          <div class="card-preview">
            <div class="explore-demo">
              <div class="explore-toolbar">获取灵感</div>
              <div class="explore-line w-full"></div>
              <div class="explore-line w-5/6"></div>
              <div class="explore-line w-4/6"></div>
            </div>
          </div>
          <h3><span class="card-tag">AI探索</span> <span class="divider">|</span> 挖掘思维深度</h3>
          <p>利用AI获取灵感深入挖掘信息，打破思维瓶颈，从而制作出全面而详细的作品。</p>
        </div>
      </div>
    </section>

    <!-- App Features -->
    <section class="app-features-section">
      <div class="features-row">
        <div class="features-preview">
          <div class="preview-window">
            <div class="window-bar"><span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span></div>
            <div class="preview-content">
              <div class="format-badges">
                <div class="fmt-badge pink">PNG</div>
                <div class="fmt-badge red">PDF</div>
                <div class="fmt-badge gray">MD</div>
                <div class="fmt-badge amber">JPG</div>
              </div>
            </div>
          </div>
        </div>
        <div class="features-list">
          <h2>功能丰富，全面提升创作效率</h2>
          <p>备注、概要、超链接、公式编辑器等功能一应俱全，让创作更轻松。</p>
          <div class="feature-items">
            <div class="feature-item" v-for="item in featureList1" :key="item.title">
              <span class="feature-icon">{{ item.icon }}</span>
              <div>
                <h4>{{ item.title }}</h4>
                <p>{{ item.desc }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="app-features-section alt">
      <div class="features-row reverse">
        <div class="features-list">
          <h2>专业工具，助力高效创作</h2>
          <p>多种布局、丰富配色、AI 对话——一站式思维导图创作平台。</p>
          <div class="feature-items">
            <div class="feature-item" v-for="item in featureList2" :key="item.title">
              <span class="feature-icon">{{ item.icon }}</span>
              <div>
                <h4>{{ item.title }}</h4>
                <p>{{ item.desc }}</p>
              </div>
            </div>
          </div>
        </div>
        <div class="features-preview">
          <div class="preview-window">
            <div class="window-bar"><span class="dot gray"></span><span class="dot gray"></span><span class="dot gray"></span></div>
            <div class="preview-content">
              <div class="color-palette">
                <div v-for="c in ['#ef4444','#f97316','#eab308','#22c55e','#0ea5e9','#6366f1','#a855f7','#ec4899']" :key="c" class="color-dot" :style="{ backgroundColor: c }"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- CTA Section -->
    <section class="cta-section">
      <div class="cta-content">
        <h2>使用 FlyMind，让创意破茧而出</h2>
        <p>无需繁琐的学习成本，即刻体验下一代智能思维整理工具。</p>
        <router-link to="/login" class="cta-btn">
          免费开始使用
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        </router-link>
        <p class="cta-sub">无需信用卡 · 免费创建无限导图 · 支持导出分享</p>
      </div>
    </section>

    <!-- Footer -->
    <footer class="footer">
      <div class="footer-inner">
        <div class="footer-columns">
          <div class="footer-col">
            <h4>关于</h4>
            <ul>
              <li><router-link to="/">首页</router-link></li>
              <li><router-link to="/dashboard">我的文件</router-link></li>
              <li><router-link to="/about">关于我们</router-link></li>
              <li><router-link to="/about">更新历史</router-link></li>
            </ul>
          </div>
          <div class="footer-col">
            <h4>帮助中心</h4>
            <ul>
              <li><router-link to="/help">新手教程</router-link></li>
              <li><router-link to="/help">常见问题</router-link></li>
              <li><router-link to="/help">用户协议</router-link></li>
              <li><router-link to="/help">隐私政策</router-link></li>
            </ul>
          </div>
          <div class="footer-col">
            <h4>联系方式</h4>
            <ul>
              <li>客服邮箱：support@flymind.com</li>
              <li>商务合作：biz@flymind.com</li>
            </ul>
          </div>
        </div>
        <div class="footer-bottom">
          <span>© 2026 FlyMind 版权所有</span>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useMindMapStore } from '@/stores/mindmap'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const mindMapStore = useMindMapStore()
const authStore = useAuthStore()

const scrolled = ref(false)
const mobileOpen = ref(false)
const activeTab = ref('text')
const inputValue = ref('')
const urlInput = ref('')
const uploadedFile = ref<File | null>(null)
const isDragging = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

const inputTabs = [
  { id: 'text', label: '✍️ 输入文本' },
  { id: 'document', label: '📄 上传文档' },
  { id: 'url', label: '🔗 网页链接' },
]

const examples = [
  { text: '帮我制定一份旅行计划' },
  { text: '整理人工智能学习笔记' },
  { text: '梳理项目管理流程' },
]

const featureList1 = [
  { icon: '👥', title: '多人协作', desc: '多人实时在线协作，让团队协作效率更上一层楼，修改即时同步可见。' },
  { icon: '📥', title: '导出多种格式', desc: '支持图片、PDF、Markdown 等常用格式，满足不同场景需求。' },
  { icon: '📐', title: 'LaTeX 公式', desc: '一站式解决数学、物理和化学等常用公式插入，专业排版更省心。' },
]

const featureList2 = [
  { icon: '📊', title: '多种布局模式', desc: '支持思维导图、树状图、组织结构图、括号图、时间轴等 5 种布局。' },
  { icon: '🎨', title: '丰富主题配色', desc: '8 套精心设计的配色方案——彩虹、晨曦、活力、和风等，一键切换主题风格。' },
  { icon: '🧠', title: 'AI 智能对话', desc: '内置 AI 助手，通过自然语言指令快速添加节点、切换布局、修改配色。' },
]

function handleTabClick(tabId: string) {
  activeTab.value = tabId
  inputValue.value = ''
  uploadedFile.value = null
  urlInput.value = ''
}

function handleExampleClick(text: string) {
  inputValue.value = text
  activeTab.value = 'text'
}

function handleGenerate() {
  let prompt = ''
  if (activeTab.value === 'url' && urlInput.value.trim()) {
    prompt = `总结以下网页链接的内容: ${urlInput.value.trim()}`
  } else if (activeTab.value === 'document' && uploadedFile.value) {
    prompt = `分析文档：${uploadedFile.value.name}`
  } else if (inputValue.value.trim()) {
    prompt = inputValue.value.trim()
  } else {
    alert('请输入内容、上传文件或输入链接')
    return
  }

  // Store prompt for the editor to pick up and run AI generation
  sessionStorage.setItem('currentPrompt', prompt)

  // Create a new map and navigate to editor
  const newMap = mindMapStore.createNewMap(prompt.substring(0, 20))
  newMap.layout = 'logic'
  mindMapStore.currentMap = newMap
  sessionStorage.setItem('mapId', newMap.id)

  // Save then navigate (for guests this saves to localStorage)
  mindMapStore.saveCurrentMap().then(() => {
    router.push(`/editor/${newMap.id}`)
  })
}

function handleFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) {
    if (file.size > 20 * 1024 * 1024) {
      alert('文件大小不能超过 20MB')
      return
    }
    uploadedFile.value = file
  }
}

function handleDrop(e: DragEvent) {
  isDragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) {
    if (file.size > 20 * 1024 * 1024) {
      alert('文件大小不能超过 20MB')
      return
    }
    uploadedFile.value = file
  }
}

function triggerFileInput() {
  fileInputRef.value?.click()
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleGenerate()
  }
}

function handleScroll() {
  scrolled.value = window.scrollY > 20
}

function scrollToFeatures() {
  const el = document.getElementById('features')
  if (el) {
    el.scrollIntoView({ behavior: 'smooth' })
  }
}

onMounted(() => {
  window.addEventListener('scroll', handleScroll)
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
})
</script>

<style scoped>
.landing-page {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  color: #1e293b;
  background: #ffffff;
  min-height: 100vh;
  overflow-y: auto;
  overflow-x: hidden;
}

/* === NavBar === */
.navbar {
  position: fixed;
  width: 100%;
  z-index: 50;
  transition: all 0.3s;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid transparent;
}
.navbar.scrolled {
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(24px);
  border-bottom-color: rgba(226, 232, 240, 0.5);
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.nav-inner {
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 64px;
}
.nav-left { display: flex; align-items: center; gap: 32px; }
.logo-link {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  transition: opacity 0.2s;
}
.logo-link:hover { opacity: 0.8; }
.logo-icon {
  color: #8b5cf6;
  display: flex;
  align-items: center;
}
.logo-text {
  font-weight: 800;
  font-size: 20px;
  color: #0f172a;
  letter-spacing: -0.5px;
}
.nav-links {
  display: none;
  gap: 4px;
}
@media (min-width: 768px) { .nav-links { display: flex; } }
.nav-link {
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #64748b;
  text-decoration: none;
  transition: all 0.2s;
}
.nav-link:hover { color: #0f172a; background: #f8fafc; }
.nav-right { display: none; }
@media (min-width: 768px) { .nav-right { display: flex; } }
.btn-login {
  background: linear-gradient(to right, #8b5cf6, #9333ea);
  color: white;
  padding: 8px 24px;
  border-radius: 9999px;
  font-weight: 700;
  font-size: 14px;
  text-decoration: none;
  transition: all 0.2s;
  box-shadow: 0 4px 6px rgba(139, 92, 246, 0.2);
}
.btn-login:hover {
  background: linear-gradient(to right, #7c3aed, #7e22ce);
  box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
}
.mobile-menu-btn {
  display: flex;
  background: transparent;
  color: #64748b;
  padding: 8px;
}
@media (min-width: 768px) { .mobile-menu-btn { display: none; } }
.mobile-menu {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  background: rgba(255,255,255,0.9);
  backdrop-filter: blur(24px);
  border-top: 1px solid #f1f5f9;
}
.mobile-link {
  padding: 12px 16px;
  border-radius: 8px;
  color: #475569;
  font-weight: 500;
  text-decoration: none;
}
.mobile-link:hover { background: #f8fafc; }
.btn-mobile-login {
  background: #8b5cf6;
  color: white;
  text-align: center;
  font-weight: 700;
  margin-top: 8px;
}

/* === Hero === */
.hero-section {
  padding: 128px 16px 96px;
  background: linear-gradient(to bottom, #faf5ff, #ffffff, #ffffff);
  text-align: center;
}
.hero-content {
  max-width: 896px;
  margin: 0 auto;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: 9999px;
  background: rgba(243, 232, 255, 0.5);
  border: 1px solid #e9d5ff;
  color: #64748b;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 32px;
}
.badge svg { color: #ec4899; }
.hero-title {
  font-size: 48px;
  font-weight: 700;
  line-height: 1.1;
  margin-bottom: 24px;
  color: #0f172a;
  letter-spacing: -1px;
}
@media (min-width: 768px) { .hero-title { font-size: 64px; } }
@media (min-width: 1024px) { .hero-title { font-size: 72px; } }
.gradient-text {
  background: linear-gradient(to right, #9333ea, #ec4899, #f97316);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.hero-desc {
  font-size: 18px;
  color: #94a3b8;
  max-width: 672px;
  margin: 0 auto 16px;
  line-height: 1.7;
}
.no-register-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 9999px;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #16a34a;
  font-size: 12px;
  font-weight: 500;
  margin-bottom: 32px;
}

/* Input Card */
.input-card {
  background: white;
  border-radius: 16px;
  box-shadow: 0 25px 50px -12px rgba(139, 92, 246, 0.15);
  border: 1px solid #f1f5f9;
  padding: 8px;
  max-width: 768px;
  margin: 0 auto;
  text-align: left;
  position: relative;
  z-index: 10;
}
.input-tabs {
  display: flex;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid #f8fafc;
  margin-bottom: 12px;
  overflow-x: auto;
}
.tab-btn {
  padding: 6px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  background: transparent;
  color: #94a3b8;
  white-space: nowrap;
  transition: all 0.2s;
}
.tab-btn:hover { background: #f8fafc; }
.tab-btn.active { background: #f5f3ff; color: #8b5cf6; }
.input-area { padding: 0 16px; margin-bottom: 8px; }
.hero-textarea {
  width: 100%;
  padding: 16px;
  background: transparent;
  border: none;
  resize: none;
  font-size: 18px;
  color: #334155;
  outline: none;
}
.hero-textarea::placeholder { color: #cbd5e1; }
.hero-url-input {
  width: 100%;
  padding: 16px;
  background: transparent;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  font-size: 14px;
  color: #334155;
  outline: none;
}
.hero-url-input:focus { border-color: #8b5cf6; box-shadow: 0 0 0 3px rgba(139,92,246,0.1); }
.upload-zone {
  border: 2px dashed #e2e8f0;
  border-radius: 12px;
  padding: 32px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
}
.upload-zone:hover, .upload-zone.dragging { border-color: #8b5cf6; background: #f5f3ff; }
.hidden-input { display: none; }
.file-info { display: flex; align-items: center; gap: 12px; justify-content: center; }
.file-name-text { font-size: 14px; font-weight: 500; color: #334155; }
.file-size-text { font-size: 12px; color: #94a3b8; }
.remove-file-btn { font-size: 12px; color: #f87171; background: transparent; margin-left: 8px; }
.remove-file-btn:hover { color: #ef4444; }
.upload-placeholder { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.upload-hint { font-size: 14px; font-weight: 500; color: #8b5cf6; }
.upload-formats { font-size: 12px; color: #94a3b8; }
.input-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  margin-top: 8px;
}
.shortcut-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  color: #94a3b8;
}
.generate-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #8b5cf6;
  color: white;
  padding: 12px 32px;
  border-radius: 12px;
  font-weight: 700;
  font-size: 16px;
  transition: all 0.2s;
  box-shadow: 0 4px 14px rgba(139, 92, 246, 0.4);
}
.generate-btn:hover { background: #7c3aed; box-shadow: 0 6px 20px rgba(139, 92, 246, 0.5); }

/* Examples */
.examples {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 12px;
  margin-top: 32px;
}
.examples-label { font-size: 14px; color: #94a3b8; }
.example-btn {
  font-size: 14px;
  color: #475569;
  background: #f8fafc;
  border: 1px solid #f1f5f9;
  padding: 6px 16px;
  border-radius: 9999px;
  transition: background 0.2s;
}
.example-btn:hover { background: #f1f5f9; }

/* === Demo === */
.demo-section {
  padding: 0 16px 64px;
  position: relative;
}
.demo-preview {
  max-width: 1024px;
  margin: 0 auto;
  border-radius: 24px;
  overflow: hidden;
  box-shadow: 0 25px 50px -12px rgba(0,0,0,0.15);
  border: 1px solid #f1f5f9;
  position: relative;
  background: linear-gradient(135deg, #faf5ff, #eef2ff, #fdf2f8);
}
.demo-mindmap-svg {
  width: 100%;
  height: auto;
  display: block;
  padding: 24px;
}
/* Animated nodes appearing */
.demo-nodes .node {
  animation: nodeAppear 0.6s ease-out both;
}
.demo-connections .conn {
  animation: lineGrow 0.5s ease-out both;
  stroke-dasharray: 200;
  stroke-dashoffset: 200;
}
.demo-nodes .n0 { animation-delay: 0s; }
.demo-connections .c1,
.demo-connections .c2,
.demo-connections .c3,
.demo-connections .c4 { animation-delay: 0.4s; }
.demo-nodes .n1 { animation-delay: 0.7s; }
.demo-nodes .n2 { animation-delay: 0.9s; }
.demo-nodes .n3 { animation-delay: 1.1s; }
.demo-nodes .n4 { animation-delay: 1.3s; }
.demo-connections .c5,
.demo-connections .c6 { animation-delay: 1.5s; }
.demo-connections .c7,
.demo-connections .c8 { animation-delay: 1.7s; }
.demo-connections .c9,
.demo-connections .c10 { animation-delay: 1.9s; }
.demo-connections .c11,
.demo-connections .c12 { animation-delay: 2.1s; }
.demo-nodes .n5,.demo-nodes .n6 { animation-delay: 2s; }
.demo-nodes .n7,.demo-nodes .n8 { animation-delay: 2.2s; }
.demo-nodes .n9,.demo-nodes .n10 { animation-delay: 2.4s; }
.demo-nodes .n11,.demo-nodes .n12 { animation-delay: 2.6s; }
@keyframes nodeAppear {
  from { opacity: 0; transform: scale(0.5); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes lineGrow {
  to { stroke-dashoffset: 0; }
}

/* === Stats === */
.stats-section {
  padding: 64px 16px;
  background: linear-gradient(135deg, #f5f3ff, #fdf2f8);
}
.stats-grid {
  max-width: 1024px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 32px;
}
@media (min-width: 768px) { .stats-grid { grid-template-columns: repeat(4, 1fr); } }
.stat-item {
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.stat-number {
  font-size: 36px;
  font-weight: 800;
  background: linear-gradient(to right, #8b5cf6, #ec4899);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.stat-label {
  font-size: 14px;
  font-weight: 500;
  color: #64748b;
}

/* === Feature Cards === */
.feature-cards-section {
  padding: 96px 16px;
  background: white;
}
.section-header {
  text-align: center;
  margin-bottom: 64px;
}
.section-header h2 { font-size: 32px; font-weight: 700; color: #0f172a; margin-bottom: 16px; }
@media (min-width: 768px) { .section-header h2 { font-size: 36px; } }
.section-header p { font-size: 18px; color: #94a3b8; }
.feature-cards-grid {
  max-width: 1152px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr;
  gap: 32px;
}
@media (min-width: 768px) { .feature-cards-grid { grid-template-columns: repeat(3, 1fr); } }
.feature-card {
  border-radius: 24px;
  padding: 32px;
  color: white;
  overflow: hidden;
  box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1);
  transition: transform 0.3s;
}
.feature-card:hover { transform: translateY(-8px); }
.card-indigo { background: linear-gradient(135deg, #4f46e5, #7e22ce); }
.card-amber { background: linear-gradient(135deg, #f59e0b, #ea580c); }
.card-cyan { background: linear-gradient(135deg, #0891b2, #1d4ed8); }
.card-preview {
  height: 160px;
  margin-bottom: 32px;
  border-radius: 16px;
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.2);
  display: flex;
  align-items: center;
  justify-content: center;
}
.ai-prompt-demo {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 24px;
  border-radius: 9999px;
  border: 1px solid rgba(255,255,255,0.3);
  background: rgba(255,255,255,0.1);
  backdrop-filter: blur(8px);
  font-size: 14px;
  font-weight: 500;
}
.file-types-demo { display: flex; gap: 12px; align-items: flex-end; }
.file-badge {
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  color: white;
}
.file-badge.pdf { background: rgba(248,113,113,0.9); transform: rotate(-12deg); height: 64px; display: flex; align-items: center; }
.file-badge.word { background: rgba(96,165,250,0.9); height: 80px; display: flex; align-items: center; z-index: 1; }
.file-badge.ppt { background: rgba(52,211,153,0.9); transform: rotate(12deg); height: 64px; display: flex; align-items: center; }
.explore-demo {
  width: 75%;
  height: 96px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.2);
  padding: 20px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 12px;
  background: rgba(255,255,255,0.05);
}
.explore-toolbar {
  position: relative;
  top: -32px;
  left: 50%;
  transform: translateX(-50%);
  background: #0891b2;
  padding: 8px 16px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 700;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  white-space: nowrap;
}
.explore-line { height: 8px; border-radius: 9999px; background: rgba(255,255,255,0.2); }
.explore-line.w-full { width: 100%; }
.explore-line.w-5\/6 { width: 83%; }
.explore-line.w-4\/6 { width: 67%; }
.feature-card h3 {
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.card-tag { opacity: 0.8; }
.divider { opacity: 0.2; }
.feature-card p { font-size: 14px; line-height: 1.6; opacity: 0.85; }

/* === App Features === */
.app-features-section { padding: 96px 16px; background: #f8fafc; }
.app-features-section.alt { background: white; }
.features-row {
  max-width: 1280px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 64px;
  align-items: center;
}
@media (min-width: 1024px) {
  .features-row { flex-direction: row; gap: 96px; }
  .features-row.reverse { flex-direction: row-reverse; }
}
.features-preview { width: 100%; }
@media (min-width: 1024px) { .features-preview { width: 50%; } }
.preview-window {
  border-radius: 16px;
  box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1);
  border: 1px solid #f1f5f9;
  overflow: hidden;
  background: white;
}
.window-bar {
  height: 40px;
  background: #f8fafc;
  border-bottom: 1px solid #f1f5f9;
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 8px;
}
.dot { width: 12px; height: 12px; border-radius: 50%; }
.dot.red { background: #f87171; }
.dot.yellow { background: #fbbf24; }
.dot.green { background: #4ade80; }
.dot.gray { background: #cbd5e1; }
.preview-content {
  padding: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 16/9;
  background: linear-gradient(135deg, #f8fafc, white);
}
.format-badges { display: flex; gap: 12px; align-items: flex-end; }
.fmt-badge { padding: 8px 12px; border-radius: 8px; font-size: 12px; font-weight: 700; }
.fmt-badge.pink { background: #fce7f3; color: #db2777; }
.fmt-badge.red { background: #fee2e2; color: #dc2626; }
.fmt-badge.gray { background: #f1f5f9; color: #475569; }
.fmt-badge.amber { background: #fef3c7; color: #d97706; }
.color-palette { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.color-dot { width: 24px; height: 24px; border-radius: 50%; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
.features-list { width: 100%; }
@media (min-width: 1024px) { .features-list { width: 50%; } }
.features-list h2 { font-size: 28px; font-weight: 700; color: #0f172a; margin-bottom: 16px; }
@media (min-width: 768px) { .features-list h2 { font-size: 32px; } }
.features-list > p { color: #64748b; font-size: 18px; margin-bottom: 32px; }
.feature-items { display: flex; flex-direction: column; gap: 16px; }
.feature-item {
  display: flex;
  gap: 16px;
  padding: 20px;
  border-radius: 12px;
  border-left: 4px solid #e2e8f0;
  cursor: pointer;
  transition: all 0.3s;
}
.feature-item:hover { background: #f5f3ff; border-left-color: #8b5cf6; }
.feature-icon { font-size: 20px; margin-top: 2px; }
.feature-item h4 { font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 4px; }
.feature-item p { font-size: 14px; color: #64748b; }

/* === CTA === */
.cta-section {
  padding: 80px 16px;
  background: linear-gradient(to right, #8b5cf6, #7e22ce);
  text-align: center;
  position: relative;
  overflow: hidden;
}
.cta-content { max-width: 896px; margin: 0 auto; position: relative; z-index: 10; }
.cta-content h2 { font-size: 36px; font-weight: 700; color: white; margin-bottom: 24px; }
.cta-content p { font-size: 18px; color: #c4b5fd; margin-bottom: 40px; }
.cta-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: white;
  color: #8b5cf6;
  padding: 16px 40px;
  border-radius: 9999px;
  font-size: 18px;
  font-weight: 700;
  text-decoration: none;
  box-shadow: 0 20px 25px -5px rgba(0,0,0,0.2);
  transition: all 0.2s;
}
.cta-btn:hover { background: #f8fafc; transform: translateY(-4px); }
.cta-sub {
  margin-top: 16px;
  font-size: 14px;
  color: #c4b5fd;
}

/* === Footer === */
.footer {
  padding: 80px 16px 32px;
  border-top: 1px solid #e2e8f0;
  background: white;
}
.footer-inner { max-width: 1280px; margin: 0 auto; }
.footer-columns {
  display: grid;
  grid-template-columns: 1fr;
  gap: 48px;
  margin-bottom: 64px;
}
@media (min-width: 768px) { .footer-columns { grid-template-columns: repeat(3, 1fr); } }
.footer-col h4 { font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 24px; }
.footer-col ul { list-style: none; display: flex; flex-direction: column; gap: 16px; }
.footer-col ul li { font-size: 14px; color: #94a3b8; }
.footer-col ul li a { color: #94a3b8; text-decoration: none; transition: color 0.2s; }
.footer-col ul li a:hover { color: #8b5cf6; }
.footer-bottom {
  border-top: 1px solid #e2e8f0;
  padding-top: 32px;
  display: flex;
  justify-content: center;
  font-size: 14px;
  color: #94a3b8;
}
</style>
