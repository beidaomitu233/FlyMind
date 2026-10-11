import assert from 'assert'
import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = 3001
const BASE_URL = `http://localhost:${PORT}/api/maps`

async function runTests() {
  console.log('Starting backend API integration tests...')
  
  // 1. Spawn the server on PORT 3001
  const serverProcess = spawn('npx', ['tsx', path.join(__dirname, '../server/server.ts')], {
    env: { ...process.env, PORT: String(PORT) },
    shell: true,
    stdio: 'pipe'
  })

  // Ensure server is killed on exit
  const cleanup = () => {
    serverProcess.kill()
  }
  process.on('exit', cleanup)
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  // Wait for server to start
  await new Promise<void>((resolve, reject) => {
    let started = false
    serverProcess.stdout?.on('data', (data) => {
      const output = data.toString()
      console.log(`[Server]: ${output.trim()}`)
      if (output.includes('running at http://localhost') || output.includes('server running')) {
        started = true
        resolve()
      }
    })
    serverProcess.stderr?.on('data', (data) => {
      console.error(`[Server Error]: ${data.toString()}`)
    })
    setTimeout(() => {
      if (!started) {
        reject(new Error('Server failed to start in 8 seconds'))
      }
    }, 8000)
  })

  try {
    const testMapId = 'test-map-123'
    const testMapData = {
      id: testMapId,
      name: 'Integration Test Map',
      data: {
        id: 'root',
        text: 'Root node',
        children: []
      }
    }

    // A. Verify DB starts empty or gets listing
    console.log('Testing GET /api/maps...')
    const getRes = await fetch(BASE_URL)
    assert.strictEqual(getRes.status, 200, 'GET /api/maps status should be 200')
    const listBefore = await getRes.json() as any[]
    assert(Array.isArray(listBefore), 'GET /api/maps should return an array')

    // B. Save a map
    console.log('Testing POST /api/maps (Save)...')
    const saveRes = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testMapData)
    })
    assert.strictEqual(saveRes.status, 200, 'POST /api/maps should return 200')
    const saved = await saveRes.json() as any
    assert.strictEqual(saved.id, testMapId, 'Saved map ID should match')
    assert.strictEqual(saved.name, 'Integration Test Map', 'Saved map name should match')

    // C. Get single map
    console.log('Testing GET /api/maps/:id...')
    const getOneRes = await fetch(`${BASE_URL}/${testMapId}`)
    assert.strictEqual(getOneRes.status, 200, 'GET /api/maps/:id should return 200')
    const one = await getOneRes.json() as any
    assert.strictEqual(one.name, 'Integration Test Map')

    // D. Move map to trash
    console.log('Testing POST /api/maps/:id/trash...')
    const trashRes = await fetch(`${BASE_URL}/${testMapId}/trash`, { method: 'POST' })
    assert.strictEqual(trashRes.status, 200, 'Trash POST should return 200')
    const trashed = await trashRes.json() as any
    assert(trashed.deletedAt, 'Trashed map should have a deletedAt timestamp')

    // E. Verify in trash list
    console.log('Testing GET /api/maps/trash...')
    const trashListRes = await fetch(`${BASE_URL}/trash`)
    const trashList = await trashListRes.json() as any[]
    assert(trashList.some(item => item.id === testMapId), 'Trashed map should be in trash list')

    // F. Restore map
    console.log('Testing POST /api/maps/:id/restore...')
    const restoreRes = await fetch(`${BASE_URL}/${testMapId}/restore`, { method: 'POST' })
    assert.strictEqual(restoreRes.status, 200, 'Restore POST should return 200')
    const restored = await restoreRes.json() as any
    assert.strictEqual(restored.deletedAt, undefined, 'Restored map deletedAt should be undefined')

    // G. Delete map permanently
    console.log('Testing DELETE /api/maps/:id...')
    const deleteRes = await fetch(`${BASE_URL}/${testMapId}`, { method: 'DELETE' })
    assert.strictEqual(deleteRes.status, 200, 'DELETE should return 200')
    const deletedStatus = await deleteRes.json() as any
    assert(deletedStatus.success, 'DELETE response should be success: true')

    // H. Verify single map returns 404 now
    console.log('Testing GET /api/maps/:id (404 check)...')
    const getDeletedRes = await fetch(`${BASE_URL}/${testMapId}`)
    assert.strictEqual(getDeletedRes.status, 404, 'Deleted map should return 404')

    console.log('All backend integration tests completed successfully! 🎉')
  } catch (e) {
    console.error('Integration test failed with error:', e)
    process.exitCode = 1
  } finally {
    console.log('Shutting down test server...')
    serverProcess.kill()
  }
}

runTests().catch((e) => {
  console.error('Fatal test error:', e)
  process.exit(1)
})
