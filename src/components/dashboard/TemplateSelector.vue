<template>
  <div class="template-overlay" @click.self="$emit('close')">
    <div class="template-modal">
      <div class="modal-header">
        <h2>选取模板</h2>
        <button class="close-btn" @click="$emit('close')">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 8.586L4.707 3.293a1 1 0 00-1.414 1.414L8.586 10l-5.293 5.293a1 1 0 101.414 1.414L10 11.414l5.293 5.293a1 1 0 001.414-1.414L11.414 10l5.293-5.293a1 1 0 00-1.414-1.414L10 8.586z"/>
          </svg>
        </button>
      </div>

      <div class="template-section">
        <h3>基本排布结构</h3>
        <div class="template-grid">
          <!-- 逻辑图 -->
          <div
            class="template-card"
            :class="{ selected: selectedTemplate === 'logic' }"
            @click="selectedTemplate = 'logic'"
          >
            <div class="template-preview mindmap-preview">
              <svg viewBox="0 0 200 120" width="100%" height="100%">
                <rect x="70" y="45" width="60" height="30" rx="6" fill="#fff" stroke="#8b5cf6" stroke-width="2"/>
                <text x="100" y="64" text-anchor="middle" font-size="10" fill="#1a1a1a">逻辑图</text>
                <rect x="10" y="15" width="50" height="24" rx="4" fill="#f8717120" stroke="#f87171" stroke-width="1"/>
                <rect x="10" y="80" width="50" height="24" rx="4" fill="#34d39920" stroke="#34d399" stroke-width="1"/>
                <rect x="140" y="15" width="50" height="24" rx="4" fill="#fb923c20" stroke="#fb923c" stroke-width="1"/>
                <rect x="140" y="80" width="50" height="24" rx="4" fill="#22d3ee20" stroke="#22d3ee" stroke-width="1"/>
                <path d="M70 60 Q50 60 60 27" stroke="#f87171" stroke-width="1.5" fill="none"/>
                <path d="M70 60 Q50 60 60 92" stroke="#34d399" stroke-width="1.5" fill="none"/>
                <path d="M130 60 Q150 60 140 27" stroke="#fb923c" stroke-width="1.5" fill="none"/>
                <path d="M130 60 Q150 60 140 92" stroke="#22d3ee" stroke-width="1.5" fill="none"/>
              </svg>
            </div>
            <span class="template-name">思维导图</span>
          </div>

          <!-- 括号图 -->
          <div
            class="template-card"
            :class="{ selected: selectedTemplate === 'bracket' }"
            @click="selectedTemplate = 'bracket'"
          >
            <div class="template-preview mindmap-preview">
              <svg viewBox="0 0 200 120" width="100%" height="100%">
                <rect x="20" y="45" width="60" height="30" rx="6" fill="#fff" stroke="#8b5cf6" stroke-width="2"/>
                <text x="50" y="64" text-anchor="middle" font-size="10" fill="#1a1a1a">括号图</text>
                <rect x="120" y="15" width="50" height="24" rx="4" fill="#f8717120" stroke="#f87171" stroke-width="1"/>
                <rect x="120" y="48" width="50" height="24" rx="4" fill="#34d39920" stroke="#34d399" stroke-width="1"/>
                <rect x="120" y="81" width="50" height="24" rx="4" fill="#fb923c20" stroke="#fb923c" stroke-width="1"/>
                <path d="M80 60 Q100 60 120 27" stroke="#f87171" stroke-width="1.5" fill="none"/>
                <path d="M80 60 Q100 60 120 60" stroke="#34d399" stroke-width="1.5" fill="none"/>
                <path d="M80 60 Q100 60 120 93" stroke="#fb923c" stroke-width="1.5" fill="none"/>
              </svg>
            </div>
            <span class="template-name">括号图</span>
          </div>

          <!-- 树形图 -->
          <div
            class="template-card"
            :class="{ selected: selectedTemplate === 'tree' }"
            @click="selectedTemplate = 'tree'"
          >
            <div class="template-preview mindmap-preview">
              <svg viewBox="0 0 200 120" width="100%" height="100%">
                <rect x="70" y="10" width="60" height="30" rx="6" fill="#fff" stroke="#8b5cf6" stroke-width="2"/>
                <text x="100" y="29" text-anchor="middle" font-size="10" fill="#1a1a1a">树形图</text>
                <rect x="10" y="75" width="50" height="24" rx="4" fill="#f8717120" stroke="#f87171" stroke-width="1"/>
                <rect x="75" y="75" width="50" height="24" rx="4" fill="#34d39920" stroke="#34d399" stroke-width="1"/>
                <rect x="140" y="75" width="50" height="24" rx="4" fill="#fb923c20" stroke="#fb923c" stroke-width="1"/>
                <path d="M100 40 L100 60 L35 60 L35 75" stroke="#f87171" stroke-width="1.5" fill="none"/>
                <path d="M100 40 L100 75" stroke="#34d399" stroke-width="1.5" fill="none"/>
                <path d="M100 40 L100 60 L165 60 L165 75" stroke="#fb923c" stroke-width="1.5" fill="none"/>
              </svg>
            </div>
            <span class="template-name">树形图</span>
          </div>

          <!-- 组织图 -->
          <div
            class="template-card"
            :class="{ selected: selectedTemplate === 'org' }"
            @click="selectedTemplate = 'org'"
          >
            <div class="template-preview mindmap-preview">
              <svg viewBox="0 0 200 120" width="100%" height="100%">
                <rect x="70" y="10" width="60" height="30" rx="6" fill="#fff" stroke="#8b5cf6" stroke-width="2"/>
                <text x="100" y="29" text-anchor="middle" font-size="10" fill="#1a1a1a">组织图</text>
                <rect x="10" y="75" width="50" height="24" rx="4" fill="#f8717120" stroke="#f87171" stroke-width="1"/>
                <rect x="140" y="75" width="50" height="24" rx="4" fill="#fb923c20" stroke="#fb923c" stroke-width="1"/>
                <path d="M100 40 L100 60 L35 60 L35 75" stroke="#f87171" stroke-width="1.5" fill="none"/>
                <path d="M100 40 L100 60 L165 60 L165 75" stroke="#fb923c" stroke-width="1.5" fill="none"/>
              </svg>
            </div>
            <span class="template-name">组织图</span>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-cancel" @click="$emit('close')">取消</button>
        <button class="btn-create" @click="$emit('create', '新建导图', selectedTemplate)">创建</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineEmits<{
  close: []
  create: [name: string, layout: string]
}>()

const selectedTemplate = ref('logic')
</script>

<style scoped>
.template-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.template-modal {
  background: var(--bg-secondary);
  border-radius: 16px;
  width: 90%;
  max-width: 700px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-lg);
  animation: modalFadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes modalFadeIn {
  from { opacity: 0; transform: scale(0.96) translateY(8px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h2 {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
  background: transparent;
  color: var(--text-secondary);
  padding: 4px;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.template-section {
  padding: 20px 24px;
  overflow-y: auto;
  flex: 1;
}

.template-section h3 {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 16px;
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 16px;
}

.template-card {
  background: var(--bg-card);
  border-radius: 12px;
  padding: 12px;
  cursor: pointer;
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-sm);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.template-card:hover {
  border-color: var(--accent-color);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.template-card.selected {
  border-color: var(--accent-color);
  background: var(--bg-hover);
  box-shadow: var(--shadow-md), 0 0 0 1px var(--accent-color);
}

.template-preview {
  width: 100%;
  aspect-ratio: 16/10;
  background: #f8fafc;
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 10px;
  border: 1px solid var(--border-color);
  transition: border-color 0.2s ease;
}

.template-card:hover .template-preview {
  border-color: var(--border-light);
}

.mindmap-preview {
  background: #f8fafc;
}

.template-name {
  display: block;
  text-align: center;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.btn-cancel {
  padding: 8px 20px;
  background: var(--bg-card);
  color: var(--text-primary);
  border-radius: 8px;
  font-size: 14px;
  border: 1px solid var(--border-color);
  transition: all 0.2s ease;
}

.btn-cancel:hover {
  background: var(--bg-hover);
  border-color: var(--border-light);
}

.btn-create {
  padding: 8px 24px;
  background: var(--accent-color);
  color: white;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  box-shadow: var(--shadow-sm);
  transition: all 0.2s ease;
}

.btn-create:hover {
  background: var(--accent-hover);
  box-shadow: var(--shadow-md);
}
</style>
