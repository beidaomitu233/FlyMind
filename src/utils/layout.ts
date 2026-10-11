import type { MindNode } from '@/types/mindmap'

interface LayoutNode {
  node: MindNode
  x: number
  y: number
  width: number
  height: number
  children: LayoutNode[]
}

const NODE_PADDING = 12
const HORIZONTAL_GAP = 100
const VERTICAL_GAP = 24
const CENTER_WIDTH = 180
const CENTER_HEIGHT = 64
const BRANCH_WIDTH = 126
const BRANCH_HEIGHT = 50

function estimateNodeSize(node: MindNode, isCenter: boolean): { width: number; height: number } {
  const textLength = node.text ? node.text.length : 1
  const fontSize = node.style?.fontSize || (isCenter ? 24 : 14)
  const charWidth = fontSize * 0.62
  const padding = NODE_PADDING * 2

  if (isCenter) {
    const width = Math.max(CENTER_WIDTH, textLength * charWidth + padding)
    return { width, height: CENTER_HEIGHT }
  }

  const width = Math.max(BRANCH_WIDTH, textLength * charWidth + padding)
  return { width, height: BRANCH_HEIGHT }
}

/**
 * Compute total height occupied by a subtree (left/right direction).
 * For down direction, this is irrelevant (width is the key metric).
 */
function subtreeHeight(n: LayoutNode): number {
  if (n.children.length === 0) return n.height
  let total = 0
  for (let i = 0; i < n.children.length; i++) {
    total += subtreeHeight(n.children[i])
    if (i < n.children.length - 1) total += VERTICAL_GAP
  }
  return Math.max(n.height, total)
}

/**
 * Compute total width occupied by a subtree (down direction).
 */
function subtreeWidth(n: LayoutNode): number {
  if (n.children.length === 0) return n.width
  let total = 0
  for (let i = 0; i < n.children.length; i++) {
    total += subtreeWidth(n.children[i])
    if (i < n.children.length - 1) total += HORIZONTAL_GAP
  }
  return Math.max(n.width, total)
}

/**
 * Recursively assign x,y to every LayoutNode.
 * For right/left: nodes stack vertically.
 * For down: nodes spread horizontally, recurse deeper.
 */
function layoutSubtree(
  node: LayoutNode,
  x: number, // x is the CENTER of this node (if down) or start point (if left/right)
  y: number, // y is the CENTER of this node
  direction: 'left' | 'right' | 'down'
): void {
  node.x = direction === 'left' ? x - node.width : x
  node.y = y - node.height / 2

  if (node.children.length === 0) return

  if (direction === 'down') {
    // Children are laid out horizontally below this node
    const totalChildWidth = node.children.reduce(
      (sum, child, i) => sum + subtreeWidth(child) + (i < node.children.length - 1 ? HORIZONTAL_GAP : 0),
      0
    )

    let curX = x - totalChildWidth / 2
    const childY = y + node.height / 2 + VERTICAL_GAP + BRANCH_HEIGHT / 2 // center of children row

    for (const child of node.children) {
      const sw = subtreeWidth(child)
      const childCenterX = curX + sw / 2
      layoutSubtree(child, childCenterX, childY, direction)
      curX += sw + HORIZONTAL_GAP
    }
  } else {
    // Children are stacked vertically to the left or right
    const totalHeight = node.children.reduce(
      (sum, child, i) => sum + subtreeHeight(child) + (i < node.children.length - 1 ? VERTICAL_GAP : 0),
      0
    )

    let curY = y - totalHeight / 2

    for (const child of node.children) {
      const sh = subtreeHeight(child)
      const childCenterY = curY + sh / 2
      const childX = direction === 'right'
        ? x + node.width + HORIZONTAL_GAP
        : x - node.width - HORIZONTAL_GAP

      layoutSubtree(child, childX, childCenterY, direction)
      curY += sh + VERTICAL_GAP
    }
  }
}

type PositionMap = Map<string, { x: number; y: number; width: number; height: number }>

function collectPositions(
  node: LayoutNode,
  result: PositionMap,
  direction: 'left' | 'right' | 'down'
): void {
  result.set(node.node.id, {
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height
  })

  // Summary node position — placed outside children bounds
  if (node.node.summary && node.children.length > 0) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity

    const startIdx = node.node.summary.startIndex ?? 0
    const endIdx = node.node.summary.endIndex ?? (node.children.length - 1)
    const targetChildren = node.children.slice(startIdx, endIdx + 1)

    for (const child of targetChildren) {
      if (child.x < minX) minX = child.x
      if (child.x + child.width > maxX) maxX = child.x + child.width
      if (child.y < minY) minY = child.y
      if (child.y + child.height > maxY) maxY = child.y + child.height
    }

    const textLen = node.node.summary.text?.length ?? 4
    const summaryWidth = Math.max(BRANCH_WIDTH, textLen * 14 * 0.62 + NODE_PADDING * 2)
    const summaryHeight = BRANCH_HEIGHT
    let sx = 0, sy = 0

    if (direction === 'down') {
      sx = (minX + maxX) / 2 - summaryWidth / 2
      sy = maxY + 45
    } else if (direction === 'left') {
      sx = minX - 45 - summaryWidth
      sy = (minY + maxY) / 2 - summaryHeight / 2
    } else {
      sx = maxX + 45
      sy = (minY + maxY) / 2 - summaryHeight / 2
    }

    result.set(node.node.summary.id, {
      x: sx, y: sy, width: summaryWidth, height: summaryHeight
    })
  }

  for (const child of node.children) {
    collectPositions(child, result, direction)
  }
}

function buildLayoutTree(nodes: MindNode[], direction: 'left' | 'right' | 'down'): LayoutNode[] {
  return nodes.map(node => {
    const size = estimateNodeSize(node, false)
    const layoutNode: LayoutNode = {
      node, x: 0, y: 0,
      width: size.width, height: size.height,
      children: []
    }
    if (node.children && node.children.length > 0) {
      layoutNode.children = buildLayoutTree(node.children, direction)
    }
    return layoutNode
  })
}

export function calculateLayout(
  root: MindNode,
  canvasWidth: number,
  canvasHeight: number,
  layoutType: string = 'logic'
): PositionMap {
  const result: PositionMap = new Map()

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

  if (layoutType === 'logic') {
    const half = Math.ceil(root.children.length / 2)
    const rightNodes = root.children.slice(0, half)
    const leftNodes = root.children.slice(half)

    const rightTrees = buildLayoutTree(rightNodes, 'right')
    const leftTrees = buildLayoutTree(leftNodes, 'left')

    if (rightTrees.length > 0) {
      const totalH = rightTrees.reduce((s, t, i) =>
        s + subtreeHeight(t) + (i < rightTrees.length - 1 ? VERTICAL_GAP : 0), 0)
      let curY = centerY - totalH / 2
      for (const t of rightTrees) {
        const sh = subtreeHeight(t)
        layoutSubtree(t, centerX + centerSize.width / 2 + HORIZONTAL_GAP, curY + sh / 2, 'right')
        curY += sh + VERTICAL_GAP
      }
      for (const t of rightTrees) collectPositions(t, result, 'right')
    }

    if (leftTrees.length > 0) {
      const totalH = leftTrees.reduce((s, t, i) =>
        s + subtreeHeight(t) + (i < leftTrees.length - 1 ? VERTICAL_GAP : 0), 0)
      let curY = centerY - totalH / 2
      for (const t of leftTrees) {
        const sh = subtreeHeight(t)
        layoutSubtree(t, centerX - centerSize.width / 2 - HORIZONTAL_GAP, curY + sh / 2, 'left')
        curY += sh + VERTICAL_GAP
      }
      for (const t of leftTrees) collectPositions(t, result, 'left')
    }

  } else if (layoutType === 'bracket') {
    const trees = buildLayoutTree(root.children, 'right')
    const totalH = trees.reduce((s, t, i) =>
      s + subtreeHeight(t) + (i < trees.length - 1 ? VERTICAL_GAP : 0), 0)
    let curY = centerY - totalH / 2
    for (const t of trees) {
      const sh = subtreeHeight(t)
      layoutSubtree(t, centerX + centerSize.width / 2 + HORIZONTAL_GAP, curY + sh / 2, 'right')
      curY += sh + VERTICAL_GAP
    }
    for (const t of trees) collectPositions(t, result, 'right')

  } else if (layoutType === 'tree' || layoutType === 'org') {
    const trees = buildLayoutTree(root.children, 'down')
    const totalW = trees.reduce((s, t, i) =>
      s + subtreeWidth(t) + (i < trees.length - 1 ? HORIZONTAL_GAP : 0), 0)
    let curX = centerX - totalW / 2
    for (const t of trees) {
      const sw = subtreeWidth(t)
      layoutSubtree(t, curX + sw / 2, centerY + centerSize.height / 2 + VERTICAL_GAP + t.height / 2, 'down')
      curX += sw + HORIZONTAL_GAP
    }
    for (const t of trees) collectPositions(t, result, 'down')

  } else {
    // Default fallback = right-only
    const trees = buildLayoutTree(root.children, 'right')
    const totalH = trees.reduce((s, t, i) =>
      s + subtreeHeight(t) + (i < trees.length - 1 ? VERTICAL_GAP : 0), 0)
    let curY = centerY - totalH / 2
    for (const t of trees) {
      const sh = subtreeHeight(t)
      layoutSubtree(t, centerX + centerSize.width / 2 + HORIZONTAL_GAP, curY + sh / 2, 'right')
      curY += sh + VERTICAL_GAP
    }
    for (const t of trees) collectPositions(t, result, 'right')
  }

  return result
}

export function getConnectionPoints(
  parentId: string,
  childId: string,
  positions: PositionMap,
  layoutType: string = 'logic'
): { startX: number; startY: number; endX: number; endY: number; isVertical: boolean } {
  const parent = positions.get(parentId)
  const child = positions.get(childId)

  if (!parent || !child) {
    return { startX: 0, startY: 0, endX: 0, endY: 0, isVertical: false }
  }

  if (layoutType === 'tree' || layoutType === 'org') {
    return {
      startX: parent.x + parent.width / 2,
      startY: parent.y + parent.height,
      endX: child.x + child.width / 2,
      endY: child.y,
      isVertical: true
    }
  }

  const isRight = child.x + child.width / 2 > parent.x + parent.width / 2
  return {
    startX: isRight ? parent.x + parent.width : parent.x,
    startY: parent.y + parent.height / 2,
    endX: isRight ? child.x : child.x + child.width,
    endY: child.y + child.height / 2,
    isVertical: false
  }
}
