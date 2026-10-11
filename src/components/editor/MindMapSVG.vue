<template>
  <svg
    class="mindmap-svg"
    width="8000"
    height="6000"
    viewBox="0 0 8000 6000"
    xmlns="http://www.w3.org/2000/svg"
    @mousemove="handleMouseMove"
    @mouseup="handleMouseUp"
    @mouseleave="handleMouseUp"
    @click="handleClickBackground"
  >
    <g v-if="mindMapStore.currentMap">
      <MindConnection
        v-for="connection in connections"
        :key="connection.key"
        :start-x="connection.startX"
        :start-y="connection.startY"
        :end-x="connection.endX"
        :end-y="connection.endY"
        :color="connection.color"
        :stroke-width="mindMapStore.currentMap.branchThickness || 2"
        :is-vertical="connection.isVertical"
        :connection-style="mindMapStore.currentMap.connectionStyle || 'curved'"
      />

      <MindNodeComponent
        v-for="nodeData in allNodes"
        :key="nodeData.node.id"
        :node="nodeData.node"
        :x="nodeData.x"
        :y="nodeData.y"
        :width="nodeData.width"
        :height="nodeData.height"
        :is-selected="mindMapStore.selectedNodeIds.includes(nodeData.node.id)"
        :is-editing="mindMapStore.editingNodeId === nodeData.node.id"
        :color="nodeData.color"
        :depth="nodeData.depth"
        :is-drag-over="dragTargetId === nodeData.node.id"
        @select="handleSelectNode(nodeData.node.id, $event)"
        @dblclick="mindMapStore.startEditing(nodeData.node.id)"
        @update-text="mindMapStore.updateNodeText(nodeData.node.id, $event)"
        @finish-edit="mindMapStore.stopEditing()"
        @node-mousedown="handleNodeMouseDown"
      />

      <!-- Summaries -->
      <g v-for="summary in summaries" :key="summary.key">
        <path :d="summary.pathData" fill="none" stroke="#8b5cf6" stroke-width="2" />
        <MindNodeComponent
          :node="summary.node"
          :x="summary.x"
          :y="summary.y"
          :width="summary.width"
          :height="summary.height"
          :is-selected="mindMapStore.selectedNodeIds.includes(summary.node.id)"
          :is-editing="mindMapStore.editingNodeId === summary.node.id"
          color="#8b5cf6"
          :depth="1"
          @select="handleSelectNode(summary.node.id, $event)"
          @dblclick="mindMapStore.startEditing(summary.node.id)"
          @update-text="mindMapStore.updateSummaryText(summary.parentId, $event)"
          @finish-edit="mindMapStore.stopEditing()"
        />
      </g>

      <!-- Ghost node for drag preview -->
      <g v-if="isDragging && draggedNodeInfo" class="ghost-node" :transform="`translate(${dragX}, ${dragY})`" opacity="0.6">
        <rect
          :width="draggedNodeInfo.width"
          :height="draggedNodeInfo.height"
          rx="6" ry="6"
          fill="#ffffff"
          stroke="#8b5cf6"
          stroke-width="2"
          stroke-dasharray="4"
        />
        <foreignObject :width="draggedNodeInfo.width" :height="draggedNodeInfo.height">
          <div xmlns="http://www.w3.org/1999/xhtml" class="node-content" style="display:flex;align-items:center;justify-content:center;height:100%;">
            <span style="font-size:14px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              {{ draggedNodeInfo.node.text }}
            </span>
          </div>
        </foreignObject>
      </g>
    </g>
  </svg>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMindMapStore } from '@/stores/mindmap'
import { getBranchColor } from '@/utils/theme'
import { getConnectionPoints } from '@/utils/layout'
import type { MindNode } from '@/types/mindmap'
import MindNodeComponent from '../mindmap/MindNode.vue'
import MindConnection from '../mindmap/MindConnection.vue'

const mindMapStore = useMindMapStore()

const allNodes = computed(() => {
  if (!mindMapStore.currentMap) return []

  const positions = mindMapStore.positions
  const result: Array<{
    node: typeof mindMapStore.currentMap.root
    x: number
    y: number
    width: number
    height: number
    color: string
    depth: number
    branchIndex: number
  }> = []

  function traverse(node: MindNode, depth: number, branchIndex: number, parentBranchIndex: number): void {
    const pos = positions.get(node.id)
    if (!pos) return

    const color = depth === 0
      ? mindMapStore.currentMap!.theme.centerStyle.stroke
      : getBranchColor(mindMapStore.currentMap!.theme, parentBranchIndex, mindMapStore.currentMap!.rainbowBranches)

    result.push({
      node,
      x: pos.x,
      y: pos.y,
      width: pos.width,
      height: pos.height,
      color,
      depth,
      branchIndex
    })

    node.children.forEach((child, idx) => {
      traverse(child, depth + 1, idx, depth === 0 ? idx : parentBranchIndex)
    })
  }

  traverse(mindMapStore.currentMap.root, 0, 0, 0)
  return result
})

const connections = computed(() => {
  if (!mindMapStore.currentMap) return []

  const positions = mindMapStore.positions
  const result: Array<{
    key: string
    startX: number
    startY: number
    endX: number
    endY: number
    color: string
    isVertical: boolean
  }> = []

  // rootBranchIndex = which top-level branch this subtree belongs to (for rainbow color)
  function traverse(node: MindNode, rootBranchIndex: number): void {
    node.children.forEach((child, idx) => {
      // For direct children of root, use their own index; deeper nodes inherit from their root branch
      const colorIndex = node.id === mindMapStore.currentMap!.root.id ? idx : rootBranchIndex
      const color = getBranchColor(mindMapStore.currentMap!.theme, colorIndex, mindMapStore.currentMap!.rainbowBranches)

      const points = getConnectionPoints(node.id, child.id, positions, mindMapStore.currentMap!.layout)
      
      if (points.startX !== 0 || points.endX !== 0 || points.startY !== 0 || points.endY !== 0) {
        result.push({
          key: `${node.id}-${child.id}`,
          startX: points.startX,
          startY: points.startY,
          endX: points.endX,
          endY: points.endY,
          color,
          isVertical: points.isVertical
        })
      }

      traverse(child, colorIndex)
    })
  }

  traverse(mindMapStore.currentMap.root, 0)
  return result
})

const summaries = computed(() => {
  if (!mindMapStore.currentMap) return []
  const positions = mindMapStore.positions
  const result: Array<{
    key: string
    parentId: string
    node: any
    x: number
    y: number
    width: number
    height: number
    pathData: string
  }> = []

  function traverse(node: MindNode) {
    if (node.summary) {
      const summaryPos = positions.get(node.summary.id)
      if (summaryPos) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
        const startIdx = node.summary.startIndex ?? 0
        const endIdx = node.summary.endIndex ?? (node.children.length - 1)
        const targetChildren = node.children.slice(startIdx, endIdx + 1)
        for (const child of targetChildren) {
          const childPos = positions.get(child.id)
          if (childPos) {
            if (childPos.x < minX) minX = childPos.x
            if (childPos.x + childPos.width > maxX) maxX = childPos.x + childPos.width
            if (childPos.y < minY) minY = childPos.y
            if (childPos.y + childPos.height > maxY) maxY = childPos.y + childPos.height
          }
        }

        let pathData = ''
        const layoutType = mindMapStore.currentMap!.layout || 'logic'
        const isDown = layoutType === 'tree' || layoutType === 'org'
        
        if (isDown) {
          const startX = minX
          const endX = maxX
          const y = maxY + 20
          const midX = (startX + endX) / 2
          pathData = `M ${startX} ${y - 5} Q ${startX} ${y}, ${startX + 5} ${y} L ${midX - 5} ${y} Q ${midX} ${y}, ${midX} ${y + 10} Q ${midX} ${y}, ${midX + 5} ${y} L ${endX - 5} ${y} Q ${endX} ${y}, ${endX} ${y - 5}`
        } else {
          const rootPos = positions.get(mindMapStore.currentMap!.root.id)
          const isLeft = rootPos && maxX < rootPos.x
          
          if (isLeft) {
            const startY = minY
            const endY = maxY
            const x = minX - 20
            const midY = (startY + endY) / 2
            pathData = `M ${x + 5} ${startY} Q ${x} ${startY}, ${x} ${startY + 5} L ${x} ${midY - 5} Q ${x} ${midY}, ${x - 10} ${midY} Q ${x} ${midY}, ${x} ${midY + 5} L ${x} ${endY - 5} Q ${x} ${endY}, ${x + 5} ${endY}`
          } else {
            const startY = minY
            const endY = maxY
            const x = maxX + 20
            const midY = (startY + endY) / 2
            pathData = `M ${x - 5} ${startY} Q ${x} ${startY}, ${x} ${startY + 5} L ${x} ${midY - 5} Q ${x} ${midY}, ${x + 10} ${midY} Q ${x} ${midY}, ${x} ${midY + 5} L ${x} ${endY - 5} Q ${x} ${endY}, ${x - 5} ${endY}`
          }
        }

        result.push({
          key: node.summary.id,
          parentId: node.id,
          node: { id: node.summary.id, text: node.summary.text, children: [] },
          x: summaryPos.x,
          y: summaryPos.y,
          width: summaryPos.width,
          height: summaryPos.height,
          pathData
        })
      }
    }
    node.children.forEach(child => traverse(child))
  }
  
  traverse(mindMapStore.currentMap.root)
  return result
})

// Custom Drag Engine
const isDragging = ref(false)
const dragStartX = ref(0)
const dragStartY = ref(0)
const dragX = ref(0)
const dragY = ref(0)
const draggedNodeId = ref<string | null>(null)
const dragTargetId = ref<string | null>(null)

const draggedNodeInfo = computed(() => {
  if (!draggedNodeId.value) return null
  return allNodes.value.find(n => n.node.id === draggedNodeId.value) || null
})

function handleNodeMouseDown(nodeId: string, event: MouseEvent) {
  draggedNodeId.value = nodeId
  isDragging.value = false
  dragStartX.value = event.clientX
  dragStartY.value = event.clientY
  
  const nodeInfo = allNodes.value.find(n => n.node.id === nodeId)
  if (nodeInfo) {
    dragX.value = nodeInfo.x
    dragY.value = nodeInfo.y
  }
}

function handleMouseMove(event: MouseEvent) {
  if (!draggedNodeId.value) return

  const dx = event.clientX - dragStartX.value
  const dy = event.clientY - dragStartY.value

  if (!isDragging.value && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
    isDragging.value = true
  }

  if (isDragging.value) {
    const nodeInfo = draggedNodeInfo.value
    if (nodeInfo) {
      // Calculate new position based on scale if needed, but for simplicity we just map client delta
      // assuming the canvas handles scale differently. Wait, SVG coordinate delta depends on CTM.
      // A quick approximation:
      const svg = (event.currentTarget as SVGSVGElement)
      let pt = svg.createSVGPoint()
      pt.x = event.clientX
      pt.y = event.clientY
      let cursorPt = pt.matrixTransform(svg.getScreenCTM()!.inverse())
      
      dragX.value = cursorPt.x - nodeInfo.width / 2
      dragY.value = cursorPt.y - nodeInfo.height / 2
      
      // Find intersection
      const target = allNodes.value.find(n => {
        if (n.node.id === draggedNodeId.value) return false
        return cursorPt.x >= n.x && cursorPt.x <= n.x + n.width &&
               cursorPt.y >= n.y && cursorPt.y <= n.y + n.height
      })
      dragTargetId.value = target ? target.node.id : null
    }
  }
}

function handleMouseUp(event: MouseEvent) {
  if (isDragging.value && dragTargetId.value && draggedNodeId.value) {
    mindMapStore.moveNode(draggedNodeId.value, dragTargetId.value)
  }
  isDragging.value = false
  draggedNodeId.value = null
  dragTargetId.value = null
}

function handleClickBackground(event: MouseEvent): void {
  if (event.target === event.currentTarget) {
    mindMapStore.selectNode(null)
  }
}

function handleSelectNode(nodeId: string, event?: MouseEvent): void {
  const isMulti = event ? (event.ctrlKey || event.metaKey) : false
  mindMapStore.selectNode(nodeId, isMulti)
}
</script>

<style scoped>
.mindmap-svg {
  display: block;
  background: transparent;
  user-select: none;
}

.ghost-node {
  pointer-events: none;
}
</style>
