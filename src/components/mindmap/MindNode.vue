<template>
  <g
    class="mind-node"
    :class="{ selected: isSelected, dragover: isDragOver }"
    :transform="`translate(${x}, ${y})`"
    @mousedown.stop="handleMouseDown"
    @dblclick.stop="$emit('dblclick')"
  >
    <!-- Standard rect shapes -->
    <rect v-if="!isPathShape"
      :width="width" :height="height"
      :rx="nodeRx" :ry="nodeRy"
      :fill="nodeStyle.fill"
      :stroke="isSelected ? '#8b5cf6' : nodeStyle.stroke"
      :stroke-width="isSelected ? 2.5 : nodeStyle.strokeWidth"
    />
    <!-- Path-based shapes -->
    <polygon v-else-if="node.style?.shape === 'diamond'"
      :points="`${width/2},2 ${width-2},${height/2} ${width/2},${height-2} 2,${height/2}`"
      :fill="nodeStyle.fill" :stroke="isSelected ? '#8b5cf6' : nodeStyle.stroke" :stroke-width="isSelected ? 2.5 : nodeStyle.strokeWidth"
    />
    <polygon v-else-if="node.style?.shape === 'parallelogram'"
      :points="`${width*0.15},2 ${width-2},2 ${width*0.85},${height-2} 2,${height-2}`"
      :fill="nodeStyle.fill" :stroke="isSelected ? '#8b5cf6' : nodeStyle.stroke" :stroke-width="isSelected ? 2.5 : nodeStyle.strokeWidth"
    />

    <foreignObject :width="width" :height="height">
      <div xmlns="http://www.w3.org/1999/xhtml" class="node-content">
        <input
          v-if="isEditing"
          ref="inputRef"
          class="node-input"
          :value="node.text"
          :style="inputStyle"
          @input="handleInput"
          @blur="$emit('finish-edit')"
          @keydown.enter.prevent="$emit('finish-edit')"
          @keydown.stop
          autofocus
        />
        <span
          v-else
          class="node-text"
          :style="textStyle"
        >{{ node.text }}</span>
      </div>
    </foreignObject>
  </g>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import type { MindNode as MindNodeType } from '@/types/mindmap'

const props = defineProps<{
  node: MindNodeType
  x: number
  y: number
  width: number
  height: number
  isSelected: boolean
  isEditing: boolean
  color: string
  depth: number
  isDragOver?: boolean
}>()

const emit = defineEmits<{
  select: [event: MouseEvent]
  dblclick: []
  'update-text': [text: string]
  'finish-edit': []
  'node-mousedown': [nodeId: string, event: MouseEvent]
}>()

const inputRef = ref<HTMLInputElement | null>(null)

const fontSize = computed(() => props.node.style?.fontSize ?? (props.depth === 0 ? 24 : 14))
const fontWeight = computed(() => props.node.style?.fontWeight ?? (props.depth === 0 ? 'bold' : '500'))
const textColor = computed(() => props.node.style?.color ?? (props.depth === 0 ? '#ffffff' : '#1a1a1a'))
const textAlign = computed(() => props.node.style?.textAlign ?? 'center')
const fontStyle = computed(() => props.node.style?.fontStyle ?? 'normal')
const textDecoration = computed(() => props.node.style?.textDecoration ?? 'none')

const PATH_SHAPES = ['diamond', 'parallelogram']
const isPathShape = computed(() => PATH_SHAPES.includes(props.node.style?.shape || ''))

const nodeRx = computed(() => {
  if (props.node.style?.shape === 'ellipse') return props.height / 2
  if (props.node.style?.shape === 'stadium') return props.height / 2
  if (props.node.style?.shape === 'rectangle') return 0
  return props.node.style?.borderRadius ?? 6
})
const nodeRy = computed(() => {
  if (props.node.style?.shape === 'ellipse') return props.height / 2
  if (props.node.style?.shape === 'stadium') return props.height / 2
  if (props.node.style?.shape === 'rectangle') return 0
  return props.node.style?.borderRadius ?? 6
})

const nodeStyle = computed(() => ({
  fill: props.node.style?.fill ?? props.color,
  stroke: props.node.style?.stroke ?? props.color,
  strokeWidth: props.node.style?.strokeWidth ?? (props.depth === 0 ? 0 : 2)
}))

const textStyle = computed(() => ({
  fontSize: `${fontSize.value}px`,
  fontWeight: fontWeight.value,
  fontStyle: fontStyle.value,
  textDecoration: textDecoration.value,
  color: textColor.value,
  textAlign: textAlign.value,
  width: '100%',
  display: 'block',
}))

const inputStyle = computed(() => ({
  fontSize: `${fontSize.value}px`,
  fontWeight: fontWeight.value,
  fontStyle: fontStyle.value,
  color: textColor.value,
  textAlign: textAlign.value,
}))

watch(() => props.isEditing, async (editing) => {
  if (editing) {
    await nextTick()
    inputRef.value?.focus()
    inputRef.value?.select()
  }
})

function handleMouseDown(e: MouseEvent): void {
  emit('select', e)
  if (props.depth > 0 && !props.isEditing) {
    emit('node-mousedown', props.node.id, e)
  }
}

function handleInput(e: Event): void {
  const target = e.target as HTMLInputElement
  emit('update-text', target.value)
}
</script>

<style scoped>
.mind-node {
  cursor: pointer;
}

.mind-node.selected rect,
.mind-node.selected polygon {
  filter: drop-shadow(0 0 6px rgba(139, 92, 246, 0.4));
}

.mind-node.dragover rect {
  stroke: #8b5cf6 !important;
  stroke-width: 3px !important;
  stroke-dasharray: 4;
}

.node-content {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 10px;
  box-sizing: border-box;
}

.node-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;
}

.node-input {
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  font-family: inherit;
  padding: 0;
  margin: 0;
}
</style>
