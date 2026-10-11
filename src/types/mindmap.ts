export interface NodeStyle {
  shape: 'rectangle' | 'rounded' | 'ellipse' | 'diamond' | 'parallelogram' | 'hexagon' | 'stadium'
  fill: string
  stroke: string
  strokeWidth: number
  fontSize: number
  fontWeight: string
  fontStyle?: string
  textDecoration?: string
  fontFamily?: string
  color: string
  borderRadius?: number
  textAlign?: 'left' | 'center' | 'right'
  nodeWidth?: number
}

export interface SummaryInfo {
  text: string
  id: string
  startIndex: number
  endIndex: number
}

export interface MindNode {
  id: string
  text: string
  children: MindNode[]
  style?: Partial<NodeStyle>
  collapsed?: boolean
  summary?: SummaryInfo
  x?: number
  y?: number
  width?: number
  height?: number
}

export interface ConnectionStyle {
  stroke: string
  strokeWidth: number
  strokeLinecap: 'round' | 'butt' | 'square'
}

export interface Theme {
  name: string
  colors: string[]
  centerStyle: NodeStyle
  branchStyle: NodeStyle
  connectionStyle: ConnectionStyle
}

export interface MindMapData {
  id: string
  name: string
  root: MindNode
  theme: Theme
  layout?: 'logic' | 'bracket' | 'org' | 'tree' | 'timeline' | 'fishbone'
  connectionStyle?: 'curved' | 'straight' | 'elbowed'
  branchThickness?: number
  rainbowBranches?: boolean
  canvas: { width: number; height: number }
}

export interface StoredFile {
  id: string
  name: string
  data: MindMapData
  thumbnail: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export interface StorageData {
  files: Record<string, StoredFile>
  recentIds: string[]
}
