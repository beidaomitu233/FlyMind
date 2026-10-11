<template>
  <aside class="style-panel">
    <!-- ===== SEGMENTED TAB HEADER ===== -->
    <div class="panel-tabs-container">
      <div class="panel-tabs">
        <button class="tab-btn" :class="{ active: activeTab === 'style' }" @click="activeTab = 'style'">样式</button>
        <button class="tab-btn" :class="{ active: activeTab === 'canvas' }" @click="activeTab = 'canvas'">画布</button>
      </div>
    </div>

    <!-- ===== CANVAS TAB ===== -->
    <div v-if="activeTab === 'canvas'" class="panel-body">
      <!-- 配色方案 -->
      <section class="section">
        <div class="section-header collapsible" @click="toggle('theme')">
          <div class="section-header-title">
            <svg :class="['chevron', { open: open.theme }]" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="8 4 16 12 8 20"/></svg>
            <span>配色方案</span>
          </div>
        </div>
        <div v-if="open.theme" class="section-content mt8">
          <div class="theme-grid">
            <div v-for="theme in allThemes" :key="theme.name" class="theme-card"
              :class="{ active: mindMapStore.currentMap?.theme.name === theme.name }"
              @click="updateMapTheme(theme.name)">
              <div class="theme-colors">
                <span v-for="(c, i) in theme.colors.slice(0,5)" :key="i" :style="{ background: c }"></span>
              </div>
              <span class="theme-label">{{ theme.name }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 结构 -->
      <section class="section">
        <div class="section-header collapsible" @click="toggle('structure')">
          <div class="section-header-title">
            <svg :class="['chevron', { open: open.structure }]" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="8 4 16 12 8 20"/></svg>
            <span>结构</span>
          </div>
        </div>
        <div v-if="open.structure" class="section-content mt8">
          <div class="layout-grid">
            <button v-for="l in layouts" :key="l.value" class="layout-btn"
              :class="{ active: mindMapStore.currentMap?.layout === l.value }"
              @click="updateMap('layout', l.value)" :title="l.label">
              <span class="layout-icon" v-html="l.svg"></span>
              <span class="layout-label">{{ l.label }}</span>
            </button>
          </div>
        </div>
      </section>

      <!-- 分支线条 -->
      <section class="section">
        <div class="section-header collapsible" @click="toggle('branch')">
          <div class="section-header-title">
            <svg :class="['chevron', { open: open.branch }]" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="8 4 16 12 8 20"/></svg>
            <span>分支线条</span>
          </div>
        </div>
        <div v-if="open.branch" class="section-content mt8">
          <div class="branch-style-grid">
            <button v-for="cs in connectionStyles" :key="cs.value" class="branch-style-btn"
              :class="{ active: (mindMapStore.currentMap?.connectionStyle || 'curved') === cs.value }"
              @click="updateMap('connectionStyle', cs.value)" :title="cs.label">
              <span v-html="cs.svg"></span>
            </button>
          </div>
          
          <div class="row mt12">
            <label class="row-label">粗细</label>
            <div class="slider-container flex-1">
              <input type="range" min="1" max="8"
                :value="mindMapStore.currentMap?.branchThickness || 2"
                @input="updateMap('branchThickness', Number(($event.target as HTMLInputElement).value))" class="range-slider" />
              <span class="slider-value">{{ mindMapStore.currentMap?.branchThickness || 2 }}px</span>
            </div>
          </div>
          
          <div class="row mt12 justify-between">
            <label class="row-label">彩虹分支</label>
            <label class="switch">
              <input type="checkbox" :checked="mindMapStore.currentMap?.rainbowBranches"
                @change="updateMap('rainbowBranches', ($event.target as HTMLInputElement).checked)" />
              <span class="slider"></span>
            </label>
          </div>
        </div>
      </section>
    </div>

    <!-- ===== STYLE TAB ===== -->
    <div v-else-if="activeTab === 'style' && selectedNode" class="panel-body">
      <!-- Node preview -->
      <div class="node-preview-wrap">
        <div class="node-preview" :style="previewStyle">{{ selectedNode.text }}</div>
      </div>

      <!-- Summary -->
      <section v-if="selectedNode.summary" class="section">
        <div class="section-header">概括</div>
        <div class="row justify-between mt8">
          <span class="row-label-text">已添加概括节点</span>
          <button class="btn-sm danger" @click="doRemoveSummary">移除</button>
        </div>
      </section>

      <!-- Shape -->
      <section class="section">
        <div class="section-header collapsible" @click="toggle('shape')">
          <div class="section-header-title">
            <svg :class="['chevron', { open: open.shape }]" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="8 4 16 12 8 20"/></svg>
            <span>形状</span>
          </div>
        </div>
        
        <div v-if="open.shape" class="section-content mt8">
          <div class="row">
            <span class="row-label">形状</span>
            <div class="custom-select flex-1">
              <select :value="selectedNode.style?.shape || 'rounded'" @change="updateStyle('shape', ($event.target as HTMLSelectElement).value)">
                <option v-for="s in shapes" :key="s.value" :value="s.value">{{ s.label }}</option>
              </select>
              <span class="select-arrow">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>
              </span>
            </div>
          </div>

          <div class="row mt12">
            <span class="row-label">填充</span>
            <div class="color-picker-trigger flex-1">
              <span class="color-swatch" :style="{ background: selectedNode.style?.fill || '#e2e8f0' }"></span>
              <span class="color-hex">{{ selectedNode.style?.fill || '#e2e8f0' }}</span>
              <input type="color" :value="selectedNode.style?.fill || '#e2e8f0'" @input="updateStyle('fill', ($event.target as HTMLInputElement).value)" class="hidden-color-input" />
            </div>
          </div>

          <div class="row mt12">
            <span class="row-label">边框</span>
            <div class="color-picker-trigger flex-1">
              <span class="color-swatch" :style="{ background: selectedNode.style?.stroke || '#94a3b8' }"></span>
              <span class="color-hex">{{ selectedNode.style?.stroke || '#94a3b8' }}</span>
              <input type="color" :value="selectedNode.style?.stroke || '#94a3b8'" @input="updateStyle('stroke', ($event.target as HTMLInputElement).value)" class="hidden-color-input" />
            </div>
          </div>

          <div class="row mt12">
            <span class="row-label">边框宽度</span>
            <div class="slider-container flex-1">
              <input type="range" min="0" max="6"
                :value="selectedNode.style?.strokeWidth || 2"
                @input="updateStyle('strokeWidth', Number(($event.target as HTMLInputElement).value))" class="range-slider" />
              <span class="slider-value">{{ selectedNode.style?.strokeWidth ?? 2 }}px</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Text -->
      <section class="section">
        <div class="section-header collapsible" @click="toggle('text')">
          <div class="section-header-title">
            <svg :class="['chevron', { open: open.text }]" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="8 4 16 12 8 20"/></svg>
            <span>文本</span>
          </div>
        </div>
        
        <div v-if="open.text" class="section-content mt8">
          <!-- Font Family & Font Size -->
          <div class="row">
            <div class="custom-select flex-1">
              <select :value="selectedNode.style?.fontFamily || 'System'" @change="updateStyle('fontFamily', ($event.target as HTMLSelectElement).value)">
                <option value="System">系统默认字体</option>
                <option value="Inter">Inter</option>
                <option value="Arial">Arial</option>
                <option value="Helvetica">Helvetica</option>
                <option value="Georgia">Georgia</option>
                <option value="Times New Roman">Times New Roman</option>
                <option value="Courier New">Courier New</option>
              </select>
              <span class="select-arrow">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>
              </span>
            </div>

            <div class="custom-select width-small">
              <select :value="selectedNode.style?.fontSize || 14" @change="updateStyle('fontSize', Number(($event.target as HTMLSelectElement).value))">
                <option v-for="size in [10, 11, 12, 13, 14, 16, 18, 20, 24, 30, 36, 48, 60]" :key="size" :value="size">{{ size }}px</option>
              </select>
              <span class="select-arrow">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>
              </span>
            </div>
          </div>

          <!-- Font Weight & Color -->
          <div class="row mt12">
            <div class="custom-select flex-1">
              <select :value="selectedNode.style?.fontWeight || 'normal'" @change="updateStyle('fontWeight', ($event.target as HTMLSelectElement).value)">
                <option value="normal">标准字重 (Normal)</option>
                <option value="bold">加粗 (Bold)</option>
                <option value="300">细体 (Lighter)</option>
                <option value="500">中等 (Medium)</option>
                <option value="800">极粗 (Black)</option>
              </select>
              <span class="select-arrow">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>
              </span>
            </div>

            <div class="color-picker-trigger width-small">
              <span class="color-swatch" :style="{ background: selectedNode.style?.color || '#1a1a1a' }"></span>
              <span class="color-hex">{{ selectedNode.style?.color || '#1a1a1a' }}</span>
              <input type="color" :value="selectedNode.style?.color || '#1a1a1a'" @input="updateStyle('color', ($event.target as HTMLInputElement).value)" class="hidden-color-input" />
            </div>
          </div>

          <!-- Format Styles (Bold, Italic, Strikethrough, Underline) -->
          <div class="row mt12">
            <div class="button-group">
              <button class="button-group-btn" :class="{ active: selectedNode.style?.fontWeight === 'bold' }"
                @click="updateStyle('fontWeight', selectedNode.style?.fontWeight === 'bold' ? 'normal' : 'bold')" title="加粗">
                <b>B</b>
              </button>
              <button class="button-group-btn" :class="{ active: selectedNode.style?.fontStyle === 'italic' }"
                @click="updateStyle('fontStyle', selectedNode.style?.fontStyle === 'italic' ? 'normal' : 'italic')" title="斜体">
                <i>I</i>
              </button>
              <button class="button-group-btn" :class="{ active: isStrikethrough }"
                @click="toggleStrikethrough" title="删除线">
                <span style="text-decoration: line-through;">S</span>
              </button>
              <button class="button-group-btn" :class="{ active: isUnderline }"
                @click="toggleUnderline" title="下划线">
                <u>U</u>
              </button>
            </div>
          </div>

          <!-- Alignment -->
          <div class="row mt12">
            <div class="button-group">
              <button class="button-group-btn" :class="{ active: selectedNode.style?.textAlign === 'left' }"
                @click="updateStyle('textAlign', 'left')" title="左对齐">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
              </button>
              <button class="button-group-btn" :class="{ active: !selectedNode.style?.textAlign || selectedNode.style?.textAlign === 'center' }"
                @click="updateStyle('textAlign', 'center')" title="居中对齐">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="3" y1="6" x2="21" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
              </button>
              <button class="button-group-btn" :class="{ active: selectedNode.style?.textAlign === 'right' }"
                @click="updateStyle('textAlign', 'right')" title="右对齐">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Reset Styles -->
      <div class="reset-wrap">
        <button class="reset-btn" @click="resetStyle">重设样式</button>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="activeTab === 'style'" class="panel-empty">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".3"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <p>选择节点以编辑样式</p>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, reactive } from 'vue'
import { useMindMapStore } from '@/stores/mindmap'
import { allThemes, getThemeByName } from '@/utils/theme'

const mindMapStore = useMindMapStore()
const activeTab = ref<'style' | 'canvas'>('style')
const open = reactive({ shape: true, text: true, theme: true, structure: true, branch: true })
function toggle(key: keyof typeof open) { open[key] = !open[key] }

const shapes = [
  { value: 'rounded', label: '圆角矩形' },
  { value: 'rectangle', label: '直角矩形' },
  { value: 'ellipse', label: '椭圆形' },
  { value: 'diamond', label: '菱形' },
  { value: 'parallelogram', label: '平行四边形' },
  { value: 'stadium', label: '胶囊形' },
]

const layouts = [
  { value: 'logic', label: '逻辑图', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="10" width="6" height="4" rx="1"/><rect x="1" y="4" width="6" height="4" rx="1"/><rect x="1" y="16" width="6" height="4" rx="1"/><line x1="7" y1="6" x2="9" y2="12"/><line x1="7" y1="18" x2="9" y2="12"/></svg>' },
  { value: 'bracket', label: '括号图', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="10" width="6" height="4" rx="1"/><rect x="16" y="4" width="6" height="4" rx="1"/><rect x="16" y="16" width="6" height="4" rx="1"/><line x1="8" y1="12" x2="16" y2="6"/><line x1="8" y1="12" x2="16" y2="18"/></svg>' },
  { value: 'org', label: '组织图', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="2" width="6" height="4" rx="1"/><rect x="2" y="16" width="6" height="4" rx="1"/><rect x="16" y="16" width="6" height="4" rx="1"/><line x1="12" y1="6" x2="12" y2="12"/><line x1="5" y1="12" x2="19" y2="12"/><line x1="5" y1="12" x2="5" y2="16"/><line x1="19" y1="12" x2="19" y2="16"/></svg>' },
  { value: 'tree', label: '树形图', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="2" width="6" height="4" rx="1"/><rect x="2" y="18" width="6" height="4" rx="1"/><rect x="16" y="18" width="6" height="4" rx="1"/><line x1="12" y1="6" x2="5" y2="18"/><line x1="12" y1="6" x2="19" y2="18"/></svg>' },
]

const connectionStyles = [
  { value: 'curved', label: '弧线', svg: '<svg width="36" height="28" viewBox="0 0 36 28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 14 C4 14,14 4,18 4 C22 4,32 14,32 14"/></svg>' },
  { value: 'straight', label: '直线', svg: '<svg width="36" height="28" viewBox="0 0 36 28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="4" y1="24" x2="32" y2="4"/></svg>' },
  { value: 'elbowed', label: '折线', svg: '<svg width="36" height="28" viewBox="0 0 36 28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><polyline points="4,24 4,4 32,4"/></svg>' },
]

const selectedNode = computed(() => {
  if (!mindMapStore.currentMap || !mindMapStore.selectedNodeId) return null
  return findNode(mindMapStore.currentMap.root, mindMapStore.selectedNodeId)
})

function findNode(root: any, id: string): any {
  if (root.id === id) return root
  for (const child of root.children) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

const previewStyle = computed(() => {
  const n = selectedNode.value
  if (!n) return {}
  return {
    background: n.style?.fill || '#e2e8f0',
    border: `${n.style?.strokeWidth || 2}px solid ${n.style?.stroke || '#94a3b8'}`,
    borderRadius: n.style?.shape === 'ellipse' ? '999px' : n.style?.shape === 'rectangle' ? '2px' : '8px',
    color: n.style?.color || '#1a1a1a',
    fontSize: (n.style?.fontSize || 14) + 'px',
    fontWeight: n.style?.fontWeight || '500',
    fontStyle: n.style?.fontStyle || 'normal',
    textDecoration: n.style?.textDecoration || 'none',
    fontFamily: n.style?.fontFamily ? (n.style.fontFamily === 'System' ? 'inherit' : n.style.fontFamily) : 'inherit',
  }
})

// Text decoration computed values
const isUnderline = computed(() => {
  return selectedNode.value?.style?.textDecoration?.includes('underline') || false
})

const isStrikethrough = computed(() => {
  return selectedNode.value?.style?.textDecoration?.includes('line-through') || false
})

function toggleUnderline() {
  const current = selectedNode.value?.style?.textDecoration || 'none'
  let newVal = 'none'
  if (current.includes('underline')) {
    newVal = current.replace('underline', '').trim()
  } else {
    newVal = current === 'none' ? 'underline' : `${current} underline`
  }
  updateStyle('textDecoration', newVal || 'none')
}

function toggleStrikethrough() {
  const current = selectedNode.value?.style?.textDecoration || 'none'
  let newVal = 'none'
  if (current.includes('line-through')) {
    newVal = current.replace('line-through', '').trim()
  } else {
    newVal = current === 'none' ? 'line-through' : `${current} line-through`
  }
  updateStyle('textDecoration', newVal || 'none')
}

function updateStyle(key: string, value: any) {
  if (!mindMapStore.selectedNodeId) return
  mindMapStore.updateNodeStyle(mindMapStore.selectedNodeId, { [key]: value } as any)
}

function updateMap(key: string, value: any) {
  mindMapStore.updateMapConfig({ [key]: value })
}

function updateMapTheme(name: string) {
  const t = getThemeByName(name)
  mindMapStore.updateMapConfig({ theme: JSON.parse(JSON.stringify(t)) })
}

function doRemoveSummary() {
  if (mindMapStore.selectedNodeId) mindMapStore.removeSummary(mindMapStore.selectedNodeId)
}

function resetStyle() {
  if (!mindMapStore.selectedNodeId) return
  mindMapStore.updateNodeStyle(mindMapStore.selectedNodeId, {
    fill: undefined,
    stroke: undefined,
    strokeWidth: undefined,
    color: undefined,
    fontSize: undefined,
    fontWeight: undefined,
    fontStyle: undefined,
    textDecoration: undefined,
    textAlign: undefined,
    shape: undefined,
    fontFamily: undefined
  })
}
</script>

<style scoped>
.style-panel {
  width: var(--panel-width, 280px);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  height: 100%;
}

/* ===== TAB HEADERS (Segmented Control style) ===== */
.panel-tabs-container {
  padding: 14px 14px 6px;
  background: transparent;
  flex-shrink: 0;
}

.panel-tabs {
  display: flex;
  background: var(--bg-primary);
  border-radius: 8px;
  padding: 3px;
  border: 1px solid var(--border-color);
}

.tab-btn {
  flex: 1;
  padding: 6px 12px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  line-height: 1.4;
}

.tab-btn:hover {
  color: var(--text-primary);
}

.tab-btn.active {
  background: var(--bg-hover);
  color: var(--text-primary);
  box-shadow: var(--shadow-sm);
}

/* ===== PANEL BODY ===== */
.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 14px 14px;
  display: flex;
  flex-direction: column;
}

/* ===== SECTION DIVIDERS ===== */
.section {
  border: none;
  border-bottom: 1px solid var(--border-color);
  background: transparent;
  padding: 14px 2px;
  margin-bottom: 0;
  border-radius: 0;
}

.section:last-of-type {
  border-bottom: none;
}

.section-header {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.section-header.collapsible {
  cursor: pointer;
  user-select: none;
}

.section-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chevron {
  transition: transform 0.15s ease;
  transform: rotate(0deg);
  color: var(--text-secondary);
}

.chevron.open {
  transform: rotate(90deg);
}

.section-content {
  animation: fadeIn 0.15s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ===== FORM CONTROLS ===== */
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.justify-between {
  justify-content: space-between;
}

.mt8 { margin-top: 8px; }
.mt12 { margin-top: 12px; }
.flex-1 { flex: 1; }
.width-small { width: 90px; flex-shrink: 0; }

.row-label {
  font-size: 13px;
  color: var(--text-secondary);
  width: 64px;
  flex-shrink: 0;
}

.row-label-text {
  font-size: 13px;
  color: var(--text-secondary);
}

/* ===== PREMIUM CUSTOM SELECTS ===== */
.custom-select {
  position: relative;
  display: flex;
  align-items: center;
}

.custom-select select {
  width: 100%;
  height: 34px;
  padding: 0 32px 0 12px;
  background: var(--bg-primary);
  border: 1.5px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  transition: all 0.2s ease;
  outline: none;
  background-image: none;
}

.custom-select select:hover {
  border-color: var(--accent-color);
  background: var(--bg-hover);
}

.custom-select select:focus {
  border-color: var(--accent-color);
  box-shadow: 0 0 0 3px var(--accent-glow);
  background: var(--bg-primary);
}

.custom-select select option {
  padding: 8px 12px;
  background: var(--bg-card);
  color: var(--text-primary);
}

.select-arrow {
  position: absolute;
  right: 10px;
  color: var(--text-muted);
  pointer-events: none;
  display: flex;
  align-items: center;
  transition: color 0.15s;
}

.custom-select:hover .select-arrow {
  color: var(--accent-color);
}

/* ===== PREMIUM SWATCH COLOR PICKERS ===== */
.color-picker-trigger {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 8px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.color-picker-trigger:hover {
  border-color: var(--accent-color);
}

.color-swatch {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1px solid rgba(0,0,0,0.15);
  box-shadow: var(--shadow-sm);
  flex-shrink: 0;
}

.color-hex {
  font-size: 12px;
  color: var(--text-primary);
  font-family: monospace;
  text-transform: uppercase;
}

.hidden-color-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  height: 100%;
  cursor: pointer;
}

/* ===== RANGE SLIDER ===== */
.slider-container {
  display: flex;
  align-items: center;
  gap: 10px;
}

.range-slider {
  flex: 1;
  height: 4px;
  background: var(--border-color);
  border-radius: 2px;
  appearance: none;
  outline: none;
  accent-color: var(--accent-color);
}

.slider-value {
  font-size: 12px;
  color: var(--text-secondary);
  width: 32px;
  text-align: right;
}

/* ===== SWITCH ===== */
.switch {
  position: relative;
  display: inline-block;
  width: 38px;
  height: 20px;
  flex-shrink: 0;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: var(--border-color);
  border-radius: 20px;
  transition: .2s;
}

.slider::before {
  position: absolute;
  content: "";
  height: 14px;
  width: 14px;
  left: 3px;
  bottom: 3px;
  background: white;
  border-radius: 50%;
  transition: .2s;
}

input:checked + .slider {
  background: var(--accent-color);
}

input:checked + .slider::before {
  transform: translateX(18px);
}

/* ===== PILL BUTTON GROUPS ===== */
.button-group {
  display: flex;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  overflow: hidden;
  width: 100%;
}

.button-group-btn {
  flex: 1;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-secondary);
  border: none;
  border-right: 1px solid var(--border-color);
  transition: all 0.15s ease;
  font-size: 13px;
}

.button-group-btn:last-child {
  border-right: none;
}

.button-group-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.button-group-btn.active {
  background: var(--bg-hover);
  color: var(--accent-color);
}

/* ===== THEME GRID ===== */
.theme-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.theme-card {
  background: var(--bg-primary);
  border: 1.5px solid var(--border-color);
  border-radius: 8px;
  padding: 8px;
  cursor: pointer;
  transition: all 0.18s ease;
}

.theme-card:hover, .theme-card.active {
  border-color: var(--accent-color);
}

.theme-card.active {
  box-shadow: 0 0 0 1px var(--accent-color);
  background: var(--bg-hover);
}

.theme-colors {
  display: flex;
  height: 12px;
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 5px;
}

.theme-colors span {
  flex: 1;
}

.theme-label {
  font-size: 11px;
  color: var(--text-secondary);
  display: block;
  text-align: center;
}

/* ===== LAYOUT GRID ===== */
.layout-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.layout-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 6px 4px;
  background: var(--bg-primary);
  border: 1.5px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-secondary);
  transition: all 0.18s ease;
  font-size: 10px;
}

.layout-btn:hover {
  border-color: var(--accent-color);
  color: var(--text-primary);
}

.layout-btn.active {
  background: var(--accent-color);
  color: white;
  border-color: var(--accent-color);
}

.layout-icon {
  display: flex;
  align-items: center;
  justify-content: center;
}

.layout-label {
  font-size: 10px;
}

/* ===== BRANCH GRID ===== */
.branch-style-grid {
  display: flex;
  gap: 6px;
}

.branch-style-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  background: var(--bg-primary);
  border: 1.5px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-secondary);
  transition: all 0.18s ease;
}

.branch-style-btn:hover {
  border-color: var(--accent-color);
  color: var(--text-primary);
}

.branch-style-btn.active {
  border-color: var(--accent-color);
  color: var(--accent-color);
  background: rgba(139,92,246,0.06);
}

/* ===== NODE PREVIEW ===== */
.node-preview-wrap {
  display: flex;
  justify-content: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-color);
}

.node-preview {
  padding: 8px 20px;
  font-size: 14px;
  min-width: 80px;
  text-align: center;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: all 0.2s ease;
}

/* ===== RESET & DANGER BUTTONS ===== */
.reset-wrap {
  margin-top: auto;
  padding: 16px 2px 2px;
}

.reset-btn {
  width: 100%;
  height: 34px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.reset-btn:hover {
  background: var(--bg-hover);
  border-color: var(--accent-color);
  color: var(--accent-color);
}

.panel-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 13px;
  padding: 40px 20px;
  text-align: center;
}

.btn-sm {
  padding: 3px 10px;
  font-size: 12px;
  border-radius: 5px;
  cursor: pointer;
  border: 1px solid;
  transition: all 0.15s;
}

.btn-sm.danger {
  color: #ef4444;
  border-color: #ef4444;
  background: transparent;
}

.btn-sm.danger:hover {
  background: rgba(239,68,68,0.1);
}
</style>
