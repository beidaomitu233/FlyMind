import type { MindMapData } from '@/types/mindmap'

/**
 * Parse a .fmd (FlyMind Document) file and extract the mind map data.
 * @param file - The File object from file input or drag-and-drop
 * @returns The parsed MindMapData or throws an error
 */
export async function importFMD(file: File): Promise<{ name: string; data: MindMapData }> {
  const text = await file.text()

  let fmd: any
  try {
    fmd = JSON.parse(text)
  } catch {
    throw new Error('Invalid .fmd file: not valid JSON')
  }

  if (fmd.type !== 'flymind') {
    throw new Error('Not a valid FlyMind document')
  }

  if (!fmd.data) {
    throw new Error('Missing mind map data in .fmd file')
  }

  const name = fmd.metadata?.name || file.name.replace(/\.fmd$/i, '') || '导入的导图'
  const data = fmd.data as MindMapData

  return { name, data }
}

/**
 * Parse a .fmd file from a string (e.g., pasted or fetched from URL).
 */
export function parseFMDString(content: string): { name: string; data: MindMapData } {
  let fmd: any
  try {
    fmd = JSON.parse(content)
  } catch {
    throw new Error('Invalid .fmd content: not valid JSON')
  }

  if (fmd.type !== 'flymind') {
    throw new Error('Not a valid FlyMind document')
  }

  if (!fmd.data) {
    throw new Error('Missing mind map data')
  }

  const name = fmd.metadata?.name || '导入的导图'
  return { name, data: fmd.data as MindMapData }
}
