import type { StoredFile } from '@/types/mindmap'
import * as localStorageDB from './storage'
import { useAuthStore } from '@/stores/auth'

const API_BASE = '/api/maps'

async function request<T>(url: string, options?: RequestInit): Promise<T | null> {
  try {
    const authStore = useAuthStore()
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(authStore.token ? { 'Authorization': `Bearer ${authStore.token}` } : {}),
        ...(options?.headers || {})
      }
    })
    if (!res.ok) {
      if (res.status === 401) {
        authStore.logout()
      }
      throw new Error(`HTTP error! status: ${res.status}`)
    }
    return await res.json() as T
  } catch (e) {
    console.warn(`API request to ${url} failed. Falling back to local storage.`, e)
    return null
  }
}

export async function getAllFiles(): Promise<StoredFile[]> {
  const remote = await request<StoredFile[]>(API_BASE)
  if (remote !== null) {
    // Keep local storage in sync as a backup
    remote.forEach(file => {
      localStorageDB.saveFile(file)
    })
    return remote
  }
  return localStorageDB.getAllFiles()
}

export async function getTrashFiles(): Promise<StoredFile[]> {
  const remote = await request<StoredFile[]>(`${API_BASE}/trash`)
  if (remote !== null) {
    return remote
  }
  return localStorageDB.getTrashFiles()
}

export async function getFile(id: string): Promise<StoredFile | null> {
  const remote = await request<StoredFile>(`${API_BASE}/${id}`)
  if (remote !== null) {
    localStorageDB.saveFile(remote)
    return remote
  }
  return localStorageDB.getFile(id)
}

export async function saveFile(file: StoredFile): Promise<void> {
  // Always write locally first to ensure immediate response
  localStorageDB.saveFile(file)
  
  await request<StoredFile>(API_BASE, {
    method: 'POST',
    body: JSON.stringify(file)
  })
}

export async function moveToTrash(id: string): Promise<void> {
  localStorageDB.moveToTrash(id)
  await request<StoredFile>(`${API_BASE}/${id}/trash`, {
    method: 'POST'
  })
}

export async function restoreFile(id: string): Promise<void> {
  localStorageDB.restoreFile(id)
  await request<StoredFile>(`${API_BASE}/${id}/restore`, {
    method: 'POST'
  })
}

export async function deleteFilePermanently(id: string): Promise<void> {
  localStorageDB.deleteFilePermanently(id)
  await request<{ success: boolean }>(`${API_BASE}/${id}`, {
    method: 'DELETE'
  })
}
