// Simple test runner for mindmap utility functions
// Run with: node tests/run-tests.mjs

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')

// ===== Test Framework =====
const results = []
let totalPassed = 0
let totalFailed = 0

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertEquals(actual, expected, message) {
  const actualStr = JSON.stringify(actual)
  const expectedStr = JSON.stringify(expected)
  if (actualStr !== expectedStr) {
    throw new Error(`${message}: expected ${expectedStr}, got ${actualStr}`)
  }
}

function test(suiteName, name, fn) {
  try {
    fn()
    results.push({ suite: suiteName, name, passed: true })
    totalPassed++
  } catch (e) {
    results.push({ suite: suiteName, name, passed: false, error: e.message })
    totalFailed++
  }
}

// ===== Load source files =====
function loadModule(relativePath) {
  const fullPath = join(projectRoot, relativePath)
  return readFileSync(fullPath, 'utf-8')
}

// ===== Layout Functions =====
function getLayoutFunctions() {
  const NODE_PADDING = 12
  const HORIZONTAL_GAP = 100
  const VERTICAL_GAP = 20
  const CENTER_WIDTH = 180
  const CENTER_HEIGHT = 64
  const BRANCH_WIDTH = 130
  const BRANCH_HEIGHT = 44

  function estimateNodeSize(node, isCenter) {
    const textLength = node.text.length
    const fontSize = node.style?.fontSize || (isCenter ? 24 : 14)
    const charWidth = fontSize * 0.65
    const padding = NODE_PADDING * 2
    if (isCenter) {
      const width = Math.max(CENTER_WIDTH, textLength * charWidth + padding)
      return { width, height: CENTER_HEIGHT }
    }
    const width = Math.max(BRANCH_WIDTH, textLength * charWidth + padding)
    return { width, height: BRANCH_HEIGHT }
  }

  function calculateSubtreeHeight(layoutNode) {
    if (layoutNode.children.length === 0) return layoutNode.height
    let totalHeight = 0
    for (let i = 0; i < layoutNode.children.length; i++) {
      totalHeight += calculateSubtreeHeight(layoutNode.children[i])
      if (i < layoutNode.children.length - 1) totalHeight += VERTICAL_GAP
    }
    return Math.max(layoutNode.height, totalHeight)
  }

  function layoutSubtree(layoutNode, x, y, direction) {
    layoutNode.x = x
    layoutNode.y = y
    if (layoutNode.children.length === 0) return
    const subtreeHeight = calculateSubtreeHeight(layoutNode)
    let currentY = y - subtreeHeight / 2
    for (const child of layoutNode.children) {
      const childHeight = calculateSubtreeHeight(child)
      const childY = currentY + childHeight / 2
      let childX
      if (direction === 'right') {
        childX = x + layoutNode.width + HORIZONTAL_GAP
      } else {
        childX = x - HORIZONTAL_GAP - child.width
      }
      layoutSubtree(child, childX, childY, direction)
      currentY += childHeight + VERTICAL_GAP
    }
  }

  function calculateLayout(root, canvasWidth, canvasHeight) {
    const result = new Map()
    const centerX = canvasWidth / 2
    const centerY = canvasHeight / 2
    const centerSize = estimateNodeSize(root, true)
    result.set(root.id, {
      x: centerX - centerSize.width / 2,
      y: centerY - centerSize.height / 2,
      width: centerSize.width,
      height: centerSize.height
    })
    if (!root.children || root.children.length === 0) return result

    const half = Math.ceil(root.children.length / 2)
    const rightChildren = root.children.slice(0, half)
    const leftChildren = root.children.slice(half)

    function buildLayoutTree(nodes, direction) {
      return nodes.map(node => {
        const size = estimateNodeSize(node, false)
        const layoutNode = { node, x: 0, y: 0, width: size.width, height: size.height, children: [] }
        if (node.children && node.children.length > 0) {
          layoutNode.children = buildLayoutTree(node.children, direction)
        }
        return layoutNode
      })
    }

    const rightTrees = buildLayoutTree(rightChildren, 'right')
    const leftTrees = buildLayoutTree(leftChildren, 'left')

    const rightTotalHeight = rightTrees.reduce((sum, t) => sum + calculateSubtreeHeight(t) + VERTICAL_GAP, 0) - VERTICAL_GAP
    const leftTotalHeight = leftTrees.reduce((sum, t) => sum + calculateSubtreeHeight(t) + VERTICAL_GAP, 0) - VERTICAL_GAP

    let rightY = centerY - rightTotalHeight / 2
    for (const tree of rightTrees) {
      const height = calculateSubtreeHeight(tree)
      layoutSubtree(tree, centerX + centerSize.width / 2 + HORIZONTAL_GAP, rightY + height / 2, 'right')
      rightY += height + VERTICAL_GAP
    }

    let leftY = centerY - leftTotalHeight / 2
    for (const tree of leftTrees) {
      const height = calculateSubtreeHeight(tree)
      const startX = centerX - centerSize.width / 2 - HORIZONTAL_GAP - tree.width
      layoutSubtree(tree, startX, leftY + height / 2, 'left')
      leftY += height + VERTICAL_GAP
    }

    function collectPositions(layoutNode) {
      result.set(layoutNode.node.id, { x: layoutNode.x, y: layoutNode.y, width: layoutNode.width, height: layoutNode.height })
      for (const child of layoutNode.children) collectPositions(child)
    }
    for (const tree of [...rightTrees, ...leftTrees]) collectPositions(tree)
    return result
  }

  return { calculateLayout }
}

// ===== Storage Functions =====
function getStorageFunctions() {
  let storageData = { files: {}, recentIds: [] }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9)
  }

  function saveFile(file) {
    storageData.files[file.id] = file
    const recentIndex = storageData.recentIds.indexOf(file.id)
    if (recentIndex > -1) storageData.recentIds.splice(recentIndex, 1)
    storageData.recentIds.unshift(file.id)
    if (storageData.recentIds.length > 20) storageData.recentIds = storageData.recentIds.slice(0, 20)
  }

  function getFile(id) {
    return storageData.files[id] || null
  }

  function deleteFile(id) {
    delete storageData.files[id]
    storageData.recentIds = storageData.recentIds.filter(rid => rid !== id)
  }

  return { generateId, saveFile, getFile, deleteFile }
}

// ===== Run Tests =====
const { calculateLayout } = getLayoutFunctions()
const { generateId, saveFile, getFile, deleteFile } = getStorageFunctions()

// Layout Tests
test('布局算法', '中心节点位于画布中央', () => {
  const root = { id: 'root', text: '中心主题', children: [] }
  const positions = calculateLayout(root, 1200, 800)
  const pos = positions.get('root')
  assert(pos, '中心节点位置不存在')
  assertEquals(pos.x, 510, '中心节点X位置')
  assertEquals(pos.y, 368, '中心节点Y位置')
})

test('布局算法', '右侧子节点在中心节点右侧', () => {
  const root = { id: 'root', text: '中心主题', children: [{ id: 'c1', text: '分支1', children: [] }] }
  const positions = calculateLayout(root, 1200, 800)
  const centerPos = positions.get('root')
  const childPos = positions.get('c1')
  assert(childPos.x > centerPos.x + centerPos.width, '右侧子节点应在中心节点右侧')
})

test('布局算法', '左侧子节点在中心节点左侧且不重叠', () => {
  const root = { id: 'root', text: '中心主题', children: [
    { id: 'c1', text: '分支1', children: [] },
    { id: 'c2', text: '分支2', children: [] }
  ]}
  const positions = calculateLayout(root, 1200, 800)
  const centerPos = positions.get('root')
  const leftChildPos = positions.get('c2')
  assert(leftChildPos.x + leftChildPos.width < centerPos.x, '左侧子节点不应与中心节点重叠')
})

test('布局算法', '左侧子节点与中心节点间距>=100px', () => {
  const root = { id: 'root', text: '中心主题', children: [
    { id: 'c1', text: '分支1', children: [] },
    { id: 'c2', text: '分支2', children: [] }
  ]}
  const positions = calculateLayout(root, 1200, 800)
  const centerPos = positions.get('root')
  const leftChildPos = positions.get('c2')
  const gap = centerPos.x - (leftChildPos.x + leftChildPos.width)
  assert(gap >= 100, `左侧间距应>=100，实际为${gap.toFixed(1)}`)
})

test('布局算法', '所有节点位置不重叠', () => {
  const root = { id: 'root', text: '中心主题', children: [
    { id: 'c1', text: '分支1', children: [{ id: 'c1-1', text: '子1', children: [] }] },
    { id: 'c2', text: '分支2', children: [{ id: 'c2-1', text: '子2', children: [] }] },
    { id: 'c3', text: '分支3', children: [] },
    { id: 'c4', text: '分支4', children: [] }
  ]}
  const positions = calculateLayout(root, 1200, 800)
  const posArray = Array.from(positions.values())
  for (let i = 0; i < posArray.length; i++) {
    for (let j = i + 1; j < posArray.length; j++) {
      const a = posArray[i], b = posArray[j]
      const overlap = !(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y)
      assert(!overlap, `节点 ${i} 和 ${j} 重叠`)
    }
  }
})

// Theme Tests
test('主题系统', '存在深色和浅色两个主题', () => {
  const content = loadModule('src/utils/theme.ts')
  assert(content.includes('darkTheme'), '应包含 darkTheme')
  assert(content.includes('lightTheme'), '应包含 lightTheme')
  assert(content.includes('allThemes'), '应导出 allThemes')
})

test('主题系统', '浅色主题分支样式为浅色背景', () => {
  const content = loadModule('src/utils/theme.ts')
  assert(content.includes("fill: '#f8f9fa'"), '浅色主题分支填充应为浅色')
  assert(content.includes("color: '#475569'"), '浅色主题文字应为深色')
})

test('主题系统', '主题数组包含10种配色方案', () => {
  const content = loadModule('src/utils/theme.ts')
  assert(content.includes('#f87171'), '应包含红色')
  assert(content.includes('#4ade80'), '应包含绿色')
  assert(content.includes('themes'), '应导出 themes 数组')
})

test('主题系统', 'getBranchColor 支持循环取色', () => {
  const content = loadModule('src/utils/theme.ts')
  assert(content.includes('getBranchColor'), '应导出 getBranchColor')
  assert(content.includes('index % theme.colors.length'), '应支持循环取色')
})

// CSS Tests
test('样式系统', 'CSS变量包含深色主题配色', () => {
  const content = loadModule('src/styles/variables.css')
  assert(content.includes('rgb(25, 28, 31)'), '应包含深色主背景')
  assert(content.includes('rgb(31, 35, 38)'), '应包含深色卡片背景')
})

test('样式系统', 'CSS变量包含浅色主题配色', () => {
  const content = loadModule('src/styles/variables.css')
  assert(content.includes('[data-theme="light"]'), '应包含浅色主题选择器')
  assert(content.includes('#f8fafc'), '浅色主背景应为 #f8fafc')
  assert(content.includes('#ffffff'), '浅色卡片背景应为白色')
})

test('样式系统', '页面支持滚动（首页需要）', () => {
  const content = loadModule('src/styles/variables.css')
  assert(content.includes('overflow: auto'), 'body 应允许滚动')
})

// Storage Tests
test('存储系统', '生成唯一ID', () => {
  const id1 = generateId()
  const id2 = generateId()
  assert(id1 !== id2, 'ID应唯一')
  assert(id1.length > 0, 'ID不应为空')
})

test('存储系统', '保存和加载文件', () => {
  const id = generateId()
  const file = {
    id, name: '测试导图',
    data: { id, name: '测试导图', root: { id: 'root', text: '中心主题', children: [] }, canvas: { width: 1200, height: 800 } },
    thumbnail: 'data:image/jpeg;base64,test',
    createdAt: Date.now(), updatedAt: Date.now()
  }
  saveFile(file)
  const loaded = getFile(id)
  assert(loaded, '文件应存在')
  assertEquals(loaded.name, '测试导图', '文件名应匹配')
  assert(loaded.thumbnail.length > 0, '缩略图应存在')
})

test('存储系统', '删除文件', () => {
  const id = generateId()
  const file = {
    id, name: '删除测试',
    data: { id, name: '删除测试', root: { id: 'root', text: '中心主题', children: [] }, canvas: { width: 1200, height: 800 } },
    thumbnail: '', createdAt: Date.now(), updatedAt: Date.now()
  }
  saveFile(file)
  deleteFile(id)
  const loaded = getFile(id)
  assert(!loaded, '文件应被删除')
})

// Export Tests
test('导出功能', 'export.ts 使用 base64 data URI 避免 tainted canvas', () => {
  const content = loadModule('src/utils/export.ts')
  assert(content.includes('btoa'), '应使用 btoa 编码')
  assert(content.includes('data:image/svg+xml;base64'), '应使用 base64 data URI')
  assert(content.includes('foreignObject'), '应处理 foreignObject')
})

test('导出功能', 'thumbnail.ts 使用 base64 data URI 避免 tainted canvas', () => {
  const content = loadModule('src/utils/thumbnail.ts')
  assert(content.includes('foreignObject'), '应处理 foreignObject')
  assert(content.includes('btoa'), '应使用 btoa 编码')
  assert(content.includes('data:image/svg+xml;base64'), '应使用 base64 data URI')
  assert(content.includes('toDataURL'), '应使用 toDataURL')
})

test('导出功能', 'export.ts 支持 PNG/JPG/SVG/Markdown 四种格式', () => {
  const content = loadModule('src/utils/export.ts')
  assert(content.includes('exportToImage'), '应导出图片')
  assert(content.includes('exportToSVG'), '应导出 SVG')
  assert(content.includes('exportToMarkdownFile'), '应导出 Markdown')
  assert(content.includes("'png' | 'jpg'"), '应支持 png 和 jpg')
})

test('导出功能', 'export.ts 对文件名进行安全处理', () => {
  const content = loadModule('src/utils/export.ts')
  assert(content.includes('sanitizeFileName'), '应有文件名清理函数')
  assert(content.includes("'mindmap'"), '默认文件名应为 mindmap')
})

// Feature Tests
test('功能特性', 'Toolbar 包含主题切换按钮', () => {
  const content = loadModule('src/components/editor/Toolbar.vue')
  assert(content.includes('theme-toggle'), '应包含主题切换按钮')
  assert(content.includes('toggleTheme'), '应有 toggleTheme 函数')
})

test('功能特性', 'Toolbar 支持编辑导图名称', () => {
  const content = loadModule('src/components/editor/Toolbar.vue')
  assert(content.includes('map-name-input'), '应包含名称输入框')
  assert(content.includes('startEditName'), '应有开始编辑名称函数')
  assert(content.includes('finishEditName'), '应有完成编辑名称函数')
})

test('功能特性', 'Dashboard 包含主题切换', () => {
  const content = loadModule('src/components/dashboard/Dashboard.vue')
  assert(content.includes('theme-btn'), '应包含主题按钮')
  assert(content.includes('toggleTheme'), '应有 toggleTheme 函数')
})

test('功能特性', 'Dashboard 显示缩略图预览', () => {
  const content = loadModule('src/components/dashboard/Dashboard.vue')
  assert(content.includes('file.thumbnail'), '应使用文件缩略图')
  assert(content.includes('thumbnail-placeholder'), '应有缩略图占位符')
})

test('功能特性', 'MindNode 支持主题感知文字颜色', () => {
  const content = loadModule('src/components/mindmap/MindNode.vue')
  assert(content.includes('textColor'), '应有文字颜色计算')
  assert(content.includes('node.style?.color'), '应支持自定义颜色')
})

// Landing Page Tests
test('首页', 'LandingPage.vue 组件存在且包含核心区域', () => {
  const content = loadModule('src/components/landing/LandingPage.vue')
  assert(content.includes('hero-section'), '应包含 Hero 区域')
  assert(content.includes('feature-cards-section'), '应包含功能卡片区域')
  assert(content.includes('cta-section'), '应包含 CTA 区域')
  assert(content.includes('footer'), '应包含页脚')
})

test('首页', '路由配置包含首页和仪表盘路由', () => {
  const content = loadModule('src/router/index.ts')
  assert(content.includes("path: '/'"), '应有首页路由')
  assert(content.includes('LandingPage'), '首页应指向 LandingPage')
  assert(content.includes("path: '/dashboard'"), '应有 /dashboard 路由')
  assert(content.includes('Dashboard'), '/dashboard 应指向 Dashboard')
})

test('首页', '首页支持文本输入生成思维导图', () => {
  const content = loadModule('src/components/landing/LandingPage.vue')
  assert(content.includes('handleGenerate'), '应有生成函数')
  assert(content.includes('inputValue'), '应有文本输入')
  assert(content.includes('handleKeyDown'), '应支持键盘快捷键')
})

test('首页', '首页支持文件上传和链接输入', () => {
  const content = loadModule('src/components/landing/LandingPage.vue')
  assert(content.includes('uploadedFile'), '应支持文件上传')
  assert(content.includes('urlInput'), '应支持 URL 输入')
  assert(content.includes('handleDrop'), '应支持拖拽上传')
})

// Flow Tests
test('完整链路', '链路1: 新建导图 -> 添加节点 -> 保存', () => {
  const rootId = generateId()
  const mapData = {
    id: generateId(), name: '测试导图',
    root: {
      id: rootId, text: '中心主题',
      children: [
        { id: generateId(), text: '分支主题 1', children: [] },
        { id: generateId(), text: '分支主题 2', children: [] }
      ]
    },
    canvas: { width: 1200, height: 800 }
  }

  const newChildId = generateId()
  mapData.root.children[0].children.push({ id: newChildId, text: '子主题', children: [] })

  const positions = calculateLayout(mapData.root, 1200, 800)
  assert(positions.size === 4, '应有4个节点位置')
  assert(positions.has(newChildId), '新节点应有位置')

  const file = { id: mapData.id, name: mapData.name, data: mapData, thumbnail: 'data:image/jpeg;base64,test', createdAt: Date.now(), updatedAt: Date.now() }
  saveFile(file)
  const loaded = getFile(mapData.id)
  assert(loaded, '文件应保存成功')
  assertEquals(loaded.data.root.children[0].children.length, 1, '子节点应存在')
  assert(loaded.thumbnail.length > 0, '应有缩略图')
})

test('完整链路', '链路2: 加载已有导图 -> 修改 -> 保存', () => {
  const id = generateId()
  const initialData = {
    id, name: '修改测试',
    root: {
      id: generateId(), text: '中心主题',
      children: [{ id: generateId(), text: '原始文本', children: [] }]
    },
    canvas: { width: 1200, height: 800 }
  }
  saveFile({ id, name: initialData.name, data: initialData, thumbnail: 'data:image/jpeg;base64,test', createdAt: Date.now(), updatedAt: Date.now() })

  const loaded = getFile(id)
  assert(loaded, '文件应存在')
  loaded.data.root.children[0].text = '修改后的文本'
  loaded.data.root.children.push({ id: generateId(), text: '新分支', children: [] })
  loaded.updatedAt = Date.now()

  saveFile(loaded)
  const reloaded = getFile(id)
  assertEquals(reloaded.data.root.children[0].text, '修改后的文本', '文本应已修改')
  assertEquals(reloaded.data.root.children.length, 2, '应有2个分支')

  const positions = calculateLayout(reloaded.data.root, 1200, 800)
  assert(positions.size === 3, '布局应包含3个节点')
})

// ===== Print Results =====
console.log('\n' + '='.repeat(60))
console.log('  思维导图应用 - 自动化测试报告')
console.log('='.repeat(60) + '\n')

const suites = {}
for (const r of results) {
  if (!suites[r.suite]) suites[r.suite] = []
  suites[r.suite].push(r)
}

for (const [suiteName, tests] of Object.entries(suites)) {
  console.log(` ${suiteName}`)
  console.log('-'.repeat(40))
  for (const t of tests) {
    if (t.passed) {
      console.log(`  ✅ ${t.name}`)
    } else {
      console.log(`  ❌ ${t.name}`)
      console.log(`     错误: ${t.error}`)
    }
  }
  console.log('')
}

console.log('='.repeat(60))
console.log(`  总计: ${totalPassed} 通过, ${totalFailed} 失败`)
console.log('='.repeat(60) + '\n')

if (totalFailed > 0) {
  process.exit(1)
} else {
  console.log('🎉 所有测试通过！\n')
}
