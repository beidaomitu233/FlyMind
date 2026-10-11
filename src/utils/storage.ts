import type { StorageData, StoredFile, MindMapData } from '@/types/mindmap'

const STORAGE_KEY = 'mindmap_data'
const PURGE_DAYS = 180
const MS_PER_DAY = 24 * 60 * 60 * 1000

function getDefaultStorage(): StorageData {
  return { files: {}, recentIds: [] }
}

export function loadStorage(): StorageData {
  let dataObj: StorageData = getDefaultStorage()
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (data) {
      dataObj = JSON.parse(data) as StorageData
    }
  } catch (e) {
    console.error('Failed to load storage:', e)
  }

  // Auto-purge items in trash older than 180 days
  const now = Date.now()
  let hasChanges = false
  for (const id in dataObj.files) {
    const file = dataObj.files[id]
    if (file.deletedAt && (now - file.deletedAt > PURGE_DAYS * MS_PER_DAY)) {
      delete dataObj.files[id]
      dataObj.recentIds = dataObj.recentIds.filter(rid => rid !== id)
      hasChanges = true
    }
  }

  if (hasChanges) {
    saveStorage(dataObj)
  }

  return dataObj
}

export function saveStorage(data: StorageData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (e) {
    console.error('Failed to save storage:', e)
  }
}

export function saveFile(file: StoredFile): void {
  const storage = loadStorage()
  storage.files[file.id] = file

  if (!file.deletedAt) {
    const recentIndex = storage.recentIds.indexOf(file.id)
    if (recentIndex > -1) {
      storage.recentIds.splice(recentIndex, 1)
    }
    storage.recentIds.unshift(file.id)

    if (storage.recentIds.length > 50) {
      storage.recentIds = storage.recentIds.slice(0, 50)
    }
  }

  saveStorage(storage)
}

export function getFile(id: string): StoredFile | null {
  const storage = loadStorage()
  return storage.files[id] || null
}

export function getAllFiles(): StoredFile[] {
  const storage = loadStorage()
  return storage.recentIds
    .map(id => storage.files[id])
    .filter((f): f is StoredFile => f !== undefined && !f.deletedAt)
}

export function getTrashFiles(): StoredFile[] {
  const storage = loadStorage()
  return Object.values(storage.files)
    .filter(f => f.deletedAt)
    .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0))
}

export function moveToTrash(id: string): void {
  const storage = loadStorage()
  if (storage.files[id]) {
    storage.files[id].deletedAt = Date.now()
    saveStorage(storage)
  }
}

export function restoreFile(id: string): void {
  const storage = loadStorage()
  if (storage.files[id]) {
    storage.files[id].deletedAt = undefined
    
    // Move to front of recent
    const recentIndex = storage.recentIds.indexOf(id)
    if (recentIndex > -1) storage.recentIds.splice(recentIndex, 1)
    storage.recentIds.unshift(id)
    
    saveStorage(storage)
  }
}

export function deleteFilePermanently(id: string): void {
  const storage = loadStorage()
  delete storage.files[id]
  storage.recentIds = storage.recentIds.filter(rid => rid !== id)
  saveStorage(storage)
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9)
}
