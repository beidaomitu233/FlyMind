import type { Theme, NodeStyle, ConnectionStyle } from '@/types/mindmap'

const centerStyle: NodeStyle = {
  shape: 'rounded',
  fill: '#ffffff',
  stroke: '#cbd5e1',
  strokeWidth: 2,
  fontSize: 24,
  fontWeight: 'bold',
  color: '#334155',
  borderRadius: 8
}

const branchStyle: NodeStyle = {
  shape: 'rounded',
  fill: '#f8f9fa',
  stroke: '#e2e8f0',
  strokeWidth: 1,
  fontSize: 14,
  fontWeight: 'normal',
  color: '#475569',
  borderRadius: 6
}

const connectionStyle: ConnectionStyle = {
  stroke: '#cbd5e1',
  strokeWidth: 2,
  strokeLinecap: 'round'
}

function createTheme(name: string, mainColor: string, colors: string[]): Theme {
  return {
    name,
    colors,
    centerStyle: { ...centerStyle, stroke: mainColor },
    branchStyle: { ...branchStyle },
    connectionStyle: { ...connectionStyle, stroke: mainColor }
  }
}

// 10 Color Schemes matching the reference image
export const themes: Theme[] = [
  createTheme('晨曦', '#f87171', ['#f87171', '#fb923c', '#4ade80', '#2dd4bf', '#60a5fa', '#c084fc']), // Coral, Orange, Green, Teal, Blue, Purple
  createTheme('彩虹', '#facc15', ['#facc15', '#3b82f6', '#8b5cf6', '#a3e635', '#f472b6', '#f87171']), // Yellow, Blue, Purple, Lime, Pink, Red
  createTheme('活力', '#ef4444', ['#ef4444', '#f97316', '#eab308', '#3b82f6', '#14b8a6', '#8b5cf6']), // Red, Orange, Yellow, Blue, Teal, Purple
  createTheme('舞动', '#3b82f6', ['#3b82f6', '#ef4444', '#f43f5e', '#fef08a', '#9f1239', '#451a03']), // Blue, Red, Rose, Light Yellow, Dark Red, Brown
  createTheme('代码', '#fef08a', ['#fef08a', '#bbf7d0', '#ffffff', '#c084fc', '#93c5fd', '#475569']), // Light Yellow, Light Green, White, Purple, Light Blue, Dark Gray
  createTheme('和风', '#ffffff', ['#ffffff', '#fecdd3', '#fb923c', '#93c5fd', '#60a5fa', '#1e3a8a']), // White, Pink, Orange, Light Blue, Blue, Navy
  createTheme('岛屿', '#ffedd5', ['#ffedd5', '#fed7aa', '#fdba74', '#bcaaa4', '#a3b18a', '#588157']), // Peach, Tan, Orange, Beige, Sage, Dark Green
  createTheme('玫瑰', '#fdf2f8', ['#fdf2f8', '#fbcfe8', '#f9a8d4', '#f472b6', '#e11d48', '#9f1239']), // Soft Pink to Deep Rose gradient
  createTheme('薄荷', '#f0fdfa', ['#f0fdfa', '#ccfbf1', '#99f6e4', '#5eead4', '#2dd4bf', '#0f766e']), // Cyan gradient
  createTheme('绿茶', '#e2e8f0', ['#e2e8f0', '#d1d5db', '#9ca3af', '#65a30d', '#4d7c0f', '#14532d']), // Gray to Green gradient
]

export const darkTheme = themes[0]
export const lightTheme = themes[0]

export const allThemes = themes

export function getBranchColor(theme: Theme, index: number, rainbowBranches: boolean = true): string {
  if (!rainbowBranches) {
    return theme.colors[0]
  }
  return theme.colors[index % theme.colors.length]
}

export function getThemeByName(name: string): Theme {
  const found = allThemes.find(t => t.name === name)
  return found || themes[0]
}
