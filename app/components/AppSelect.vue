<script setup lang="ts">
import { Fragment, type VNode } from 'vue'

defineOptions({ inheritAttrs: false })

type SelectValue = string | number | boolean | null | undefined
type SelectItem = { label: string, value: SelectValue, disabled?: boolean }
type InternalSelectValue = string | number | boolean

const EMPTY_VALUE = '__app_select_empty__'
const NULL_VALUE = '__app_select_null__'
const UNDEFINED_VALUE = '__app_select_undefined__'

const [model, modifiers] = defineModel<SelectValue, 'number'>({
  set(value) {
    if (!modifiers.number || value === null || value === undefined || value === '') return value
    const numeric = Number(value)
    return Number.isNaN(numeric) ? value : numeric
  }
})
const emit = defineEmits<{ change: [event: Event] }>()
const slots = useSlots()

const encodeValue = (value: SelectValue): InternalSelectValue => {
  if (value === '') return EMPTY_VALUE
  if (value === null) return NULL_VALUE
  if (value === undefined) return UNDEFINED_VALUE
  return value
}

const decodeValue = (value: InternalSelectValue): SelectValue => {
  if (value === EMPTY_VALUE) return ''
  if (value === NULL_VALUE) return null
  if (value === UNDEFINED_VALUE) return undefined
  return value
}

const selectedValue = computed<InternalSelectValue>({
  get: () => encodeValue(model.value),
  set: value => { model.value = decodeValue(value) }
})

const textContent = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(textContent).join('')
  if (value && typeof value === 'object' && 'children' in value) return textContent((value as VNode).children)
  return ''
}

const collectOptions = (nodes: VNode[], result: SelectItem[] = []): SelectItem[] => {
  for (const node of nodes) {
    if (node.type === Fragment && Array.isArray(node.children)) {
      collectOptions(node.children as VNode[], result)
      continue
    }
    if (node.type !== 'option') continue
    const label = textContent(node.children).trim()
    result.push({
      label,
      value: encodeValue(node.props?.value ?? label),
      disabled: Boolean(node.props?.disabled)
    })
  }
  return result
}

const items = computed(() => collectOptions((slots.default?.() ?? []) as VNode[]))
</script>

<template>
  <USelect
    v-model="selectedValue"
    class="app-select"
    :items="items"
    v-bind="$attrs"
    @change="emit('change', $event)"
  />
</template>
