export function generateThumbnail(svgElement: SVGElement): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const clone = svgElement.cloneNode(true) as SVGElement
      const bbox = (svgElement as SVGGraphicsElement).getBBox()
      const padding = 20

      clone.setAttribute('viewBox', `${bbox.x - padding} ${bbox.y - padding} ${bbox.width + padding * 2} ${bbox.height + padding * 2}`)
      clone.setAttribute('width', '320')
      clone.setAttribute('height', '200')

      const foreignObjects = clone.querySelectorAll('foreignObject')
      foreignObjects.forEach(fo => {
        const parent = fo.parentNode
        if (!parent) return
        const x = parseFloat(fo.getAttribute('x') || '0')
        const y = parseFloat(fo.getAttribute('y') || '0')
        const w = parseFloat(fo.getAttribute('width') || '100')
        const h = parseFloat(fo.getAttribute('height') || '40')

        const textEl = fo.querySelector('.node-text, .node-input')
        if (textEl) {
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
          text.setAttribute('x', String(x + w / 2))
          text.setAttribute('y', String(y + h / 2 + 4))
          text.setAttribute('text-anchor', 'middle')
          text.setAttribute('dominant-baseline', 'middle')
          
          // Get the actual inline color or use a fallback
          const computedColor = (textEl as HTMLElement).style.color || '#333333'
          text.setAttribute('fill', computedColor)
          
          const fontSize = (textEl as HTMLElement).style.fontSize || '14px'
          // approximate SVG font size visually
          const svgFontSize = Math.max(8, parseInt(fontSize) * 0.8)
          text.setAttribute('font-size', String(svgFontSize))
          
          const fontWeight = (textEl as HTMLElement).style.fontWeight || 'normal'
          text.setAttribute('font-weight', fontWeight)
          
          text.textContent = textEl.textContent || ''
          parent.replaceChild(text, fo)
        } else {
          parent.removeChild(fo)
        }
      })

      const svgData = new XMLSerializer().serializeToString(clone)

      // Use base64 data URI to avoid tainted canvas issues
      const base64Svg = btoa(unescape(encodeURIComponent(svgData)))
      const url = `data:image/svg+xml;base64,${base64Svg}`

      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        return resolve('')
      }

      canvas.width = 320
      canvas.height = 200

      const img = new Image()
      img.onload = () => {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, 320, 200)
        ctx.drawImage(img, 0, 0, 320, 200)
        resolve(canvas.toDataURL('image/jpeg', 0.8))
      }
      img.onerror = () => {
        resolve('')
      }
      img.src = url
    } catch (e) {
      console.warn('Thumbnail SVG generation failed:', e)
      resolve('')
    }
  })
}
