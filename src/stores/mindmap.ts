import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { MindMapData, MindNode, StoredFile } from '@/types/mindmap'
import { themes, getBranchColor } from '@/utils/theme'
import * as api from '@/utils/api'
import { generateId } from '@/utils/storage'
import { calculateLayout } from '@/utils/layout'
import { generateThumbnail } from '@/utils/thumbnail'
import { generateMindMap } from '@/utils/ai'

export const useMindMapStore = defineStore('mindmap', () => {
  const currentMap = ref<MindMapData | null>(null)
  const selectedNodeId = ref<string | null>(null)
  const selectedNodeIds = ref<string[]>([])
  const editingNodeId = ref<string | null>(null)
  const editingMapName = ref(false)
  const isModified = ref(false)

  // Undo/Redo history
  const history = ref<string[]>([]) // JSON snapshots of root
  const historyIndex = ref(-1)
  const MAX_HISTORY = 50
  const canUndo = computed(() => historyIndex.value > 0)
  const canRedo = computed(() => historyIndex.value < history.value.length - 1)

  function snapshot(): void {
    if (!currentMap.value) return
    const snap = JSON.stringify(currentMap.value.root)
    // Discard any future history if we branched
    if (historyIndex.value < history.value.length - 1) {
      history.value = history.value.slice(0, historyIndex.value + 1)
    }
    history.value.push(snap)
    if (history.value.length > MAX_HISTORY) {
      history.value.shift()
    } else {
      historyIndex.value = history.value.length - 1
    }
  }

  function undo(): void {
    if (!canUndo.value || !currentMap.value) return
    historyIndex.value--
    currentMap.value.root = JSON.parse(history.value[historyIndex.value])
    isModified.value = true
    autoSave()
  }

  function redo(): void {
    if (!canRedo.value || !currentMap.value) return
    historyIndex.value++
    currentMap.value.root = JSON.parse(history.value[historyIndex.value])
    isModified.value = true
    autoSave()
  }

  const positions = computed(() => {
    if (!currentMap.value) return new Map()
    return calculateLayout(
      currentMap.value.root,
      8000,
      6000,
      currentMap.value.layout
    )
  })

  function createNewMap(name: string = '新建导图'): MindMapData {
    const rootId = generateId()
    const theme = JSON.parse(JSON.stringify(themes[0]))
    return {
      id: generateId(),
      name,
      root: {
        id: rootId,
        text: '中心主题',
        children: [
          { id: generateId(), text: '分支主题 1', children: [] },
          { id: generateId(), text: '分支主题 2', children: [] },
          { id: generateId(), text: '分支主题 3', children: [] },
          { id: generateId(), text: '分支主题 4', children: [] }
        ]
      },
      theme,
      layout: 'logic',
      branchThickness: 2,
      rainbowBranches: true,
      canvas: { width: 1200, height: 800 }
    }
  }

  async function loadMap(id: string): Promise<boolean> {
    const file = await api.getFile(id)
    if (file) {
      currentMap.value = JSON.parse(JSON.stringify(file.data))
      // Backwards compatibility
      if (currentMap.value && currentMap.value.rainbowBranches === undefined) {
        currentMap.value.rainbowBranches = true
        currentMap.value.layout = 'logic'
        currentMap.value.branchThickness = 2
      }
      selectedNodeId.value = null
      selectedNodeIds.value = []
      editingNodeId.value = null
      editingMapName.value = false
      isModified.value = false
      // Reset history
      if (!currentMap.value) return false
      history.value = [JSON.stringify(currentMap.value.root)]
      historyIndex.value = 0
      return true
    }
    return false
  }

  async function saveCurrentMap(): Promise<void> {
    if (!currentMap.value) return

    const svgElement = document.querySelector('.mindmap-svg') as SVGElement
    let thumbnail = ''
    if (svgElement) {
      try {
        thumbnail = await generateThumbnail(svgElement)
      } catch (e) {
        console.warn('Thumbnail generation failed:', e)
      }
    }

    const existing = await api.getFile(currentMap.value.id)
    const file: StoredFile = {
      id: currentMap.value.id,
      name: currentMap.value.name,
      data: JSON.parse(JSON.stringify(currentMap.value)),
      thumbnail,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now()
    }

    await api.saveFile(file)
    isModified.value = false
  }

  function updateMapName(name: string): void {
    if (!currentMap.value) return
    currentMap.value.name = name
    isModified.value = true
    autoSave()
  }

  function updateMapConfig(config: Partial<MindMapData>): void {
    if (!currentMap.value) return
    Object.assign(currentMap.value, config)
    isModified.value = true
    autoSave()
  }

  function updateNodeText(nodeId: string, text: string): void {
    if (!currentMap.value) return
    const node = findNode(currentMap.value.root, nodeId)
    if (node) {
      node.text = text
      isModified.value = true
      autoSave()
      // Don't snapshot every keystroke; snapshot on finish-edit instead
    }
  }

  function snapshotAndSave(): void {
    snapshot()
    isModified.value = true
    autoSave()
  }

  function addChildNode(parentId: string): string | null {
    if (!currentMap.value) return null
    const parent = findNode(currentMap.value.root, parentId)
    if (!parent) return null

    snapshot()
    const branchIndex = parent.children.length
    const color = getBranchColor(currentMap.value.theme, branchIndex, currentMap.value.rainbowBranches)
    
    const newNode: MindNode = {
      id: generateId(),
      text: '新主题',
      children: [],
      style: {
        fill: color,
        stroke: color,
        color: '#1a1a1a'
      }
    }

    parent.children.push(newNode)
    selectedNodeId.value = newNode.id
    editingNodeId.value = newNode.id
    isModified.value = true
    autoSave()
    return newNode.id
  }

  function addSiblingNode(nodeId: string): string | null {
    if (!currentMap.value) return null
    const parent = findParent(currentMap.value.root, nodeId)
    if (!parent) return null

    const index = parent.children.findIndex(c => c.id === nodeId)
    if (index === -1) return null

    snapshot()
    const branchIndex = parent.children.length
    const color = getBranchColor(currentMap.value.theme, branchIndex, currentMap.value.rainbowBranches)

    const newNode: MindNode = {
      id: generateId(),
      text: '新主题',
      children: [],
      style: {
        fill: color,
        stroke: color,
        color: '#334155'
      }
    }

    parent.children.splice(index + 1, 0, newNode)
    selectedNodeId.value = newNode.id
    editingNodeId.value = newNode.id
    isModified.value = true
    autoSave()
    return newNode.id
  }

  function deleteNode(nodeId: string): boolean {
    if (!currentMap.value) return false

    // If target nodeId is in the multi-select array, delete all selected nodes
    if (selectedNodeIds.value.includes(nodeId)) {
      snapshot()
      let hasDeleted = false
      const toDelete = selectedNodeIds.value.filter(id => id !== currentMap.value!.root.id)

      toDelete.forEach(id => {
        const parent = findParent(currentMap.value!.root, id)
        if (parent) {
          const index = parent.children.findIndex(c => c.id === id)
          if (index !== -1) {
            parent.children.splice(index, 1)
            hasDeleted = true
          }
        }
      })

      if (hasDeleted) {
        selectedNodeId.value = null
        selectedNodeIds.value = []
        isModified.value = true
        autoSave()
        return true
      }
      return false
    }

    if (nodeId === currentMap.value.root.id) return false

    const parent = findParent(currentMap.value.root, nodeId)
    if (!parent) return false

    const index = parent.children.findIndex(c => c.id === nodeId)
    if (index === -1) return false

    snapshot()
    parent.children.splice(index, 1)
    selectedNodeId.value = null
    selectedNodeIds.value = []
    isModified.value = true
    autoSave()
    return true
  }

  function moveNode(nodeId: string, newParentId: string): boolean {
    if (!currentMap.value) return false
    if (nodeId === currentMap.value.root.id) return false
    if (nodeId === newParentId) return false

    const node = findNode(currentMap.value.root, nodeId)
    const newParent = findNode(currentMap.value.root, newParentId)
    if (!node || !newParent) return false

    if (findNode(node, newParentId)) return false

    const oldParent = findParent(currentMap.value.root, nodeId)
    if (!oldParent) return false

    const index = oldParent.children.findIndex(c => c.id === nodeId)
    if (index === -1) return false

    snapshot()
    oldParent.children.splice(index, 1)
    newParent.children.push(node)
    
    isModified.value = true
    autoSave()
    return true
  }

  function selectNode(nodeId: string | null, isMulti: boolean = false): void {
    if (nodeId === null) {
      selectedNodeId.value = null
      selectedNodeIds.value = []
      return
    }

    if (isMulti) {
      const idx = selectedNodeIds.value.indexOf(nodeId)
      if (idx > -1) {
        selectedNodeIds.value.splice(idx, 1)
        if (selectedNodeId.value === nodeId) {
          selectedNodeId.value = selectedNodeIds.value.length > 0
            ? selectedNodeIds.value[selectedNodeIds.value.length - 1]
            : null
        }
      } else {
        selectedNodeIds.value.push(nodeId)
        selectedNodeId.value = nodeId
      }
    } else {
      selectedNodeId.value = nodeId
      selectedNodeIds.value = [nodeId]
    }
  }

  function startEditing(nodeId: string): void {
    editingNodeId.value = nodeId
  }

  function stopEditing(): void {
    editingNodeId.value = null
  }

  function startEditingMapName(): void {
    editingMapName.value = true
  }

  function stopEditingMapName(): void {
    editingMapName.value = false
  }

  function updateNodeStyle(nodeId: string, style: Partial<MindNode['style']>): void {
    if (!currentMap.value) return

    // Apply layout style update to all selected nodes if part of current selection
    if (selectedNodeIds.value.includes(nodeId)) {
      selectedNodeIds.value.forEach(id => {
        const node = findNode(currentMap.value!.root, id)
        if (node) {
          node.style = { ...node.style, ...style }
        }
      })
      isModified.value = true
      autoSave()
      return
    }

    const node = findNode(currentMap.value.root, nodeId)
    if (node) {
      node.style = { ...node.style, ...style }
      isModified.value = true
      autoSave()
    }
  }

  let saveTimeout: ReturnType<typeof setTimeout> | null = null
  function autoSave(): void {
    if (saveTimeout) clearTimeout(saveTimeout)
    saveTimeout = setTimeout(() => {
      saveCurrentMap()
    }, 800)
  }

  function findNode(root: MindNode, id: string): MindNode | null {
    if (root.id === id) return root
    for (const child of root.children) {
      const found = findNode(child, id)
      if (found) return found
    }
    return null
  }

  function findParent(root: MindNode, id: string): MindNode | null {
    for (const child of root.children) {
      if (child.id === id) return root
      const found = findParent(child, id)
      if (found) return found
    }
    return null
  }

  function getBranchIndexForNode(nodeId: string): number {
    if (!currentMap.value) return 0
    const parent = findParent(currentMap.value.root, nodeId)
    if (!parent) return 0
    return parent.children.findIndex(c => c.id === nodeId)
  }

  function addSummary(): void {
    if (!currentMap.value) return
    if (selectedNodeIds.value.length === 0) return

    const firstId = selectedNodeIds.value[0]
    if (firstId === currentMap.value.root.id) return // Cannot summarize root

    const parent = findParent(currentMap.value.root, firstId)
    if (!parent || parent.children.length === 0) return

    // Filter selectedNodeIds to only those that are children of this parent
    const siblingIds = parent.children.map(c => c.id)
    const selectedSiblings = selectedNodeIds.value.filter(id => siblingIds.includes(id))
    if (selectedSiblings.length === 0) return

    const indices = selectedSiblings.map(id => siblingIds.indexOf(id))
    const minIdx = Math.min(...indices)
    const maxIdx = Math.max(...indices)

    parent.summary = {
      id: generateId(),
      text: '概括内容',
      startIndex: minIdx,
      endIndex: maxIdx
    }

    selectedNodeId.value = parent.summary.id
    selectedNodeIds.value = [parent.summary.id]
    editingNodeId.value = parent.summary.id
    isModified.value = true
    autoSave()
  }

  function removeSummary(nodeId: string): void {
    if (!currentMap.value) return
    const parent = findParent(currentMap.value.root, nodeId)
    if (parent && parent.summary) {
      parent.summary = undefined
      isModified.value = true
      autoSave()
    }
  }

  function updateSummaryText(parentId: string, text: string): void {
    if (!currentMap.value) return
    const parent = findNode(currentMap.value.root, parentId)
    if (parent && parent.summary) {
      parent.summary.text = text
      isModified.value = true
      autoSave()
    }
  }

  // ── AI Generation ──────────────────────────────────
  const aiGenerating = ref(false)
  const aiError = ref<string | null>(null)

  async function generateFromAI(prompt: string): Promise<boolean> {
    if (!currentMap.value) return false
    aiGenerating.value = true
    aiError.value = null
    try {
      const aiRoot = await generateMindMap(prompt)
      // Replace root with AI-generated tree
      currentMap.value.root = aiRoot
      currentMap.value.name = prompt.substring(0, 20)
      snapshot()
      isModified.value = true
      autoSave()
      return true
    } catch (e: any) {
      aiError.value = e.message || 'AI generation failed'
      console.error('AI generation error:', e)
      return false
    } finally {
      aiGenerating.value = false
    }
  }

  return {
    currentMap,
    selectedNodeId,
    selectedNodeIds,
    editingNodeId,
    editingMapName,
    isModified,
    positions,
    canUndo,
    canRedo,
    undo,
    redo,
    createNewMap,
    loadMap,
    saveCurrentMap,
    updateMapName,
    updateMapConfig,
    updateNodeText,
    addChildNode,
    addSiblingNode,
    deleteNode,
    moveNode,
    selectNode,
    startEditing,
    stopEditing,
    startEditingMapName,
    stopEditingMapName,
    updateNodeStyle,
    getBranchIndexForNode,
    addSummary,
    removeSummary,
    updateSummaryText,
    findParent,
    findNode,
    aiGenerating,
    aiError,
    generateFromAI,
  }
})
