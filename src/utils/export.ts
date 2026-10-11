function sanitizeFileName(name: string): string {
  return name
    .replace(/[\r\n]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim() || 'mindmap'
}

export function exportToImage(svgElement: SVGElement, format: 'png' | 'jpg', fileName: string): void {
  const safeFileName = sanitizeFileName(fileName)
  
  // Calculate bounding box on the original attached SVG element first
  const originalGroup = svgElement.querySelector('g')
  let minX = 0
  let minY = 0
  let viewBoxW = 1200
  let viewBoxH = 800
  
  if (originalGroup) {
    try {
      const bbox = (originalGroup as SVGGElement).getBBox()
      if (bbox.width > 0 && bbox.height > 0) {
        const padding = 80
        minX = bbox.x - padding
        minY = bbox.y - padding
        viewBoxW = bbox.width + padding * 2
        viewBoxH = bbox.height + padding * 2
      }
    } catch (e) {
      console.warn('getBBox failed, using default boundaries:', e)
    }
  }

  const clone = svgElement.cloneNode(true) as SVGElement
  const contentGroup = clone.querySelector('g')
  if (!contentGroup) return

  // Query foreignObject elements from original DOM and cloned DOM to map computed styling
  const originalFos = svgElement.querySelectorAll('foreignObject')
  const foreignObjects = clone.querySelectorAll('foreignObject')
  
  foreignObjects.forEach((fo, idx) => {
    const parent = fo.parentNode
    if (!parent) return
    const w = parseFloat(fo.getAttribute('width') || '100')
    const h = parseFloat(fo.getAttribute('height') || '40')

    const originalFo = originalFos[idx]
    const originalTextEl = originalFo ? originalFo.querySelector('.node-text, .node-input') : null
    const textEl = fo.querySelector('.node-text, .node-input')
    
    if (textEl && originalTextEl) {
      const computedStyle = window.getComputedStyle(originalTextEl)
      const color = computedStyle.color || '#333333'
      const fontSize = computedStyle.fontSize || '14px'
      const fontWeight = computedStyle.fontWeight || 'normal'
      const fontFamily = computedStyle.fontFamily || "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      // Position text centered in its box
      text.setAttribute('x', String(w / 2))
      text.setAttribute('y', String(h / 2 + 5))
      text.setAttribute('text-anchor', 'middle')
      text.setAttribute('dominant-baseline', 'middle')
      text.setAttribute('font-size', fontSize.replace('px', ''))
      text.setAttribute('font-weight', fontWeight)
      text.setAttribute('font-family', fontFamily)
      text.setAttribute('fill', color)
      text.textContent = textEl.textContent || ''
      parent.replaceChild(text, fo)
    } else {
      parent.removeChild(fo)
    }
  })

  const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  styleEl.textContent = `
    .mind-node rect { stroke-width: 1.5; }
    .mind-connection { stroke-linecap: round; }
  `
  clone.insertBefore(styleEl, clone.firstChild)

  clone.setAttribute('viewBox', `${minX} ${minY} ${viewBoxW} ${viewBoxH}`)
  clone.setAttribute('width', String(viewBoxW))
  clone.setAttribute('height', String(viewBoxH))
  clone.removeAttribute('style')

  let svgData = new XMLSerializer().serializeToString(clone)
  svgData = svgData.replace(/&nbsp;/g, ' ')

  // Use base64 data URI to avoid tainted canvas issues
  const base64Svg = btoa(unescape(encodeURIComponent(svgData)))
  const dataUrl = `data:image/svg+xml;base64,${base64Svg}`

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const scale = 2
  canvas.width = Math.round(viewBoxW * scale)
  canvas.height = Math.round(viewBoxH * scale)

  if (format === 'jpg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  const img = new Image()
  img.onload = () => {
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0, viewBoxW, viewBoxH)

    try {
      const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png'
      canvas.toBlob(blob => {
        if (!blob) return
        const downloadUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = downloadUrl
        a.download = `${safeFileName}.${format}`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(downloadUrl)
      }, mimeType, 0.95)
    } catch (e) {
      console.error('Export failed:', e)
      try {
        const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png'
        const fallbackDataUrl = canvas.toDataURL(mimeType, 0.95)
        const a = document.createElement('a')
        a.href = fallbackDataUrl
        a.download = `${safeFileName}.${format}`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      } catch (e2) {
        console.error('Fallback export also failed:', e2)
      }
    }
  }
  img.onerror = () => {
    console.error('Failed to load SVG for export')
  }
  img.src = dataUrl
}

export function exportToSVG(svgElement: SVGElement, fileName: string): void {
  const safeFileName = sanitizeFileName(fileName)
  const clone = svgElement.cloneNode(true) as SVGElement
  const svgData = new XMLSerializer().serializeToString(clone)
  const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeFileName}.svg`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function exportToMarkdownFile(markdownText: string, fileName: string): void {
  const safeFileName = sanitizeFileName(fileName)
  const blob = new Blob([markdownText], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeFileName}.md`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Export mind map as a .fmd (FlyMind Document) file.
 * This format can be shared and imported by other users.
 */
export function exportToFMD(
  data: any,
  name: string,
  author?: string
): void {
  const safeFileName = sanitizeFileName(name)
  const fmd = {
    version: '1.0',
    type: 'flymind',
    metadata: {
      name,
      author: author || 'FlyMind User',
      createdAt: Date.now(),
      exportedAt: Date.now(),
    },
    data,
  }
  const json = JSON.stringify(fmd, null, 2)
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeFileName}.fmd`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
