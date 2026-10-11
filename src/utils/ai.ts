import type { MindNode } from '@/types/mindmap'
import { generateId } from './storage'

/**
 * Call the backend AI endpoint (SSE) and collect the full response,
 * then parse it into a MindNode tree.
 */
export async function generateMindMap(prompt: string): Promise<MindNode> {
  const response = await fetch('/api/ai/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })

  if (!response.ok) {
    throw new Error(`AI generation failed: ${response.status}`)
  }

  if (!response.body) {
    throw new Error('No response body')
  }

  // Read SSE stream
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let fullContent = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value, { stream: true })
    // Parse SSE lines
    const lines = chunk.split('\n')
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') break
      try {
        const parsed = JSON.parse(data)
        if (parsed.content) {
          fullContent += parsed.content
        }
        if (parsed.error) {
          throw new Error(parsed.error)
        }
      } catch {
        // ignore parse errors for partial chunks
      }
    }
  }

  // Extract JSON from the response (handle possible markdown code blocks)
  let jsonStr = fullContent.trim()
  // Strip markdown code fences if present
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim()
  }

  // Try to parse
  let aiTree: any
  try {
    aiTree = JSON.parse(jsonStr)
  } catch {
    // Try to extract JSON object from the text
    const objMatch = jsonStr.match(/\{[\s\S]*\}/)
    if (objMatch) {
      aiTree = JSON.parse(objMatch[0])
    } else {
      throw new Error('Failed to parse AI response as JSON')
    }
  }

  // Convert AI tree to MindNode tree
  return convertToMindNode(aiTree)
}

/**
 * Convert the AI JSON tree { text, children } into MindNode format with IDs.
 */
function convertToMindNode(node: any): MindNode {
  const mindNode: MindNode = {
    id: generateId(),
    text: node.text || node.name || '未命名',
    children: [],
  }

  if (Array.isArray(node.children)) {
    mindNode.children = node.children.map((child: any) => convertToMindNode(child))
  }

  return mindNode
}
