import { generateId } from '@/utils/storage'
import type { MindNode } from '@/types/mindmap'

export function parseMarkdown(text: string): MindNode[] {
  const lines = text.split('\n').filter(l => l.trim().length > 0)
  if (lines.length === 0) return []

  const rootNodes: MindNode[] = []
  const stack: { depth: number, node: MindNode }[] = []

  // Helper to determine depth based on indentation (tabs or spaces)
  function getIndentDepth(line: string): number {
    const match = line.match(/^([ \t]*)/)
    if (!match) return 0
    const indentStr = match[1]
    let depth = 0
    for (const char of indentStr) {
      if (char === '\t') depth += 4
      else depth += 1
    }
    return Math.floor(depth / 2) // Assume 2 spaces or 1 tab per level for normalization
  }

  lines.forEach(line => {
    const rawDepth = getIndentDepth(line)
    const textContent = line.replace(/^[ \t]+/, '').replace(/^[-*+]\s+/, '').trim()
    
    if (!textContent) return

    const newNode: MindNode = {
      id: generateId(),
      text: textContent,
      children: [],
      style: {}
    }

    if (stack.length === 0) {
      rootNodes.push(newNode)
      stack.push({ depth: rawDepth, node: newNode })
      return
    }

    while (stack.length > 0 && stack[stack.length - 1].depth >= rawDepth) {
      stack.pop()
    }

    if (stack.length === 0) {
      rootNodes.push(newNode)
    } else {
      stack[stack.length - 1].node.children.push(newNode)
    }

    stack.push({ depth: rawDepth, node: newNode })
  })

  return rootNodes
}

export function stringifyMarkdown(node: MindNode, level: number = 0): string {
  const indent = '\t'.repeat(level)
  let result = `${indent}${node.text}\n`
  
  if (node.children && node.children.length > 0) {
    node.children.forEach(child => {
      result += stringifyMarkdown(child, level + 1)
    })
  }
  
  return result
}
