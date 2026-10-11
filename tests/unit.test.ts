import { calculateLayout } from '@/utils/layout'
import { defaultTheme, getBranchColor, branchColors } from '@/utils/theme'
import { generateId, saveFile, getFile, deleteFile, loadStorage, saveStorage } from '@/utils/storage'
import type { MindNode, StoredFile } from '@/types/mindmap'

export interface TestResult {
  name: string
  passed: boolean
  error?: string
}

export interface TestSuite {
  name: string
  results: TestResult[]
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function createTestRoot(children: MindNode[] = []): MindNode {
  return { id: 'root', text: '中心主题', children }
}

export function runLayoutTests(): TestSuite {
  const results: TestResult[] = []

  function test(name: string, fn: () => void): void {
    try {
      fn()
      results.push({ name, passed: true })
    } catch (e: any) {
      results.push({ name, passed: false, error: e.message })
    }
  }

  test('中心节点位于画布中央', () => {
    const root = createTestRoot()
    const positions = calculateLayout(root, 1200, 800)
    const pos = positions.get('root')
    assert(!!pos, '中心节点位置不存在')
    assertEquals(pos!.x, 510, '中心节点X位置')
    assertEquals(pos!.y, 368, '中心节点Y位置')
  })

  test('右侧子节点在中心节点右侧', () => {
    const root = createTestRoot([{ id: 'c1', text: '分支1', children: [] }])
    const positions = calculateLayout(root, 1200, 800)
    const centerPos = positions.get('root')!
    const childPos = positions.get('c1')!
    assert(childPos.x > centerPos.x + centerPos.width, '右侧子节点应在中心节点右侧')
  })

  test('左侧子节点在中心节点左侧且不重叠', () => {
    const root = createTestRoot([
      { id: 'c1', text: '分支1', children: [] },
      { id: 'c2', text: '分支2', children: [] }
    ])
    const positions = calculateLayout(root, 1200, 800)
    const centerPos = positions.get('root')!
    const leftChildPos = positions.get('c2')!
    assert(leftChildPos.x + leftChildPos.width < centerPos.x, '左侧子节点不应与中心节点重叠')
  })

  test('多层级子节点正确布局', () => {
    const root = createTestRoot([
      {
        id: 'c1', text: '分支1',
        children: [
          { id: 'c1-1', text: '子分支1', children: [] },
          { id: 'c1-2', text: '子分支2', children: [] }
        ]
      },
      { id: 'c2', text: '分支2', children: [] }
    ])
    const positions = calculateLayout(root, 1200, 800)
    const c1Pos = positions.get('c1')!
    const c11Pos = positions.get('c1-1')!
    assert(c11Pos.x > c1Pos.x + c1Pos.width, '子节点应在父节点右侧')
  })

  test('所有节点位置不重叠', () => {
    const root = createTestRoot([
      { id: 'c1', text: '分支1', children: [{ id: 'c1-1', text: '子1', children: [] }] },
      { id: 'c2', text: '分支2', children: [{ id: 'c2-1', text: '子2', children: [] }] },
      { id: 'c3', text: '分支3', children: [] },
      { id: 'c4', text: '分支4', children: [] }
    ])
    const positions = calculateLayout(root, 1200, 800)
    const posArray = Array.from(positions.values())
    for (let i = 0; i < posArray.length; i++) {
      for (let j = i + 1; j < posArray.length; j++) {
        const a = posArray[i]
        const b = posArray[j]
        const overlap = !(a.x + a.width < b.x || b.x + b.width < a.x ||
          a.y + a.height < b.y || b.y + b.height < a.y)
        assert(!overlap, `节点 ${i} 和 ${j} 重叠`)
      }
    }
  })

  test('左侧子节点与中心节点有足够间距', () => {
    const root = createTestRoot([
      { id: 'c1', text: '分支1', children: [] },
      { id: 'c2', text: '分支2', children: [] }
    ])
    const positions = calculateLayout(root, 1200, 800)
    const centerPos = positions.get('root')!
    const leftChildPos = positions.get('c2')!
    const gap = centerPos.x - (leftChildPos.x + leftChildPos.width)
    assert(gap >= 80, `左侧间距应>=80，实际为${gap}`)
  })

  return { name: '布局算法测试', results }
}

export function runThemeTests(): TestSuite {
  const results: TestResult[] = []

  function test(name: string, fn: () => void): void {
    try {
      fn()
      results.push({ name, passed: true })
    } catch (e: any) {
      results.push({ name, passed: false, error: e.message })
    }
  }

  test('默认主题包含8种分支颜色', () => {
    assert(defaultTheme.colors.length === 8, '应有8种分支颜色')
  })

  test('分支颜色循环分配', () => {
    const color0 = getBranchColor(defaultTheme, 0)
    const color8 = getBranchColor(defaultTheme, 8)
    assertEquals(color0, color8, '索引0和8的颜色应相同')
  })

  test('中心主题样式为白色背景', () => {
    assertEquals(defaultTheme.centerStyle.fill, '#ffffff', '中心主题填充应为白色')
  })

  test('分支颜色数组包含预期颜色', () => {
    assert(branchColors.length === 8, '分支颜色数组应有8个颜色')
    assert(branchColors[0] === '#f87171', '第一个分支颜色应为红色')
  })

  return { name: '主题系统测试', results }
}

export function runStorageTests(): TestSuite {
  const results: TestResult[] = []

  function test(name: string, fn: () => void): void {
    try {
      fn()
      results.push({ name, passed: true })
    } catch (e: any) {
      results.push({ name, passed: false, error: e.message })
    }
  }

  test('生成唯一ID', () => {
    const id1 = generateId()
    const id2 = generateId()
    assert(id1 !== id2, 'ID应唯一')
    assert(id1.length > 0, 'ID不应为空')
  })

  test('保存和加载文件', () => {
    const id = generateId()
    const file: StoredFile = {
      id,
      name: '测试导图',
      data: {
        id,
        name: '测试导图',
        root: { id: 'root', text: '中心主题', children: [] },
        theme: {
          name: 'test',
          colors: ['#ff0000'],
          centerStyle: { shape: 'rounded', fill: '#fff', stroke: '#000', strokeWidth: 1, fontSize: 24, fontWeight: 'bold', color: '#000' },
          branchStyle: { shape: 'rounded', fill: '#fff', stroke: '#000', strokeWidth: 1, fontSize: 14, fontWeight: 'normal', color: '#000' },
          connectionStyle: { stroke: '#000', strokeWidth: 1, strokeLinecap: 'round' }
        },
        canvas: { width: 1200, height: 800 }
      },
      thumbnail: '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    saveFile(file)
    const loaded = getFile(id)
    assert(!!loaded, '文件应存在')
    assertEquals(loaded!.name, '测试导图', '文件名应匹配')
  })

  test('删除文件', () => {
    const id = generateId()
    const file: StoredFile = {
      id,
      name: '删除测试',
      data: {
        id,
        name: '删除测试',
        root: { id: 'root', text: '中心主题', children: [] },
        theme: {
          name: 'test',
          colors: ['#ff0000'],
          centerStyle: { shape: 'rounded', fill: '#fff', stroke: '#000', strokeWidth: 1, fontSize: 24, fontWeight: 'bold', color: '#000' },
          branchStyle: { shape: 'rounded', fill: '#fff', stroke: '#000', strokeWidth: 1, fontSize: 14, fontWeight: 'normal', color: '#000' },
          connectionStyle: { stroke: '#000', strokeWidth: 1, strokeLinecap: 'round' }
        },
        canvas: { width: 1200, height: 800 }
      },
      thumbnail: '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    saveFile(file)
    deleteFile(id)
    const loaded = getFile(id)
    assert(!loaded, '文件应被删除')
  })

  test('最近文件列表按时间排序', () => {
    const storage = loadStorage()
    if (storage.recentIds.length >= 2) {
      const firstId = storage.recentIds[0]
      const secondId = storage.recentIds[1]
      const firstFile = storage.files[firstId]
      const secondFile = storage.files[secondId]
      if (firstFile && secondFile) {
        assert(firstFile.updatedAt >= secondFile.updatedAt, '最近文件应按时间降序排列')
      }
    }
  })

  return { name: '存储系统测试', results }
}

export function runAllTests(): TestSuite[] {
  return [
    runLayoutTests(),
    runThemeTests(),
    runStorageTests()
  ]
}

export function printTestResults(suites: TestSuite[]): void {
  let totalPassed = 0
  let totalFailed = 0

  console.log('\n' + '='.repeat(60))
  console.log('  思维导图应用 - 自动化测试报告')
  console.log('='.repeat(60) + '\n')

  for (const suite of suites) {
    console.log(`📋 ${suite.name}`)
    console.log('-'.repeat(40))

    for (const result of suite.results) {
      if (result.passed) {
        console.log(`  ✅ ${result.name}`)
        totalPassed++
      } else {
        console.log(`  ❌ ${result.name}`)
        console.log(`     错误: ${result.error}`)
        totalFailed++
      }
    }
    console.log('')
  }

  console.log('='.repeat(60))
  console.log(`  总计: ${totalPassed} 通过, ${totalFailed} 失败`)
  console.log('='.repeat(60) + '\n')

  if (totalFailed > 0) {
    process.exit(1)
  }
}
