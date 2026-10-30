import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const key = 'eat-decider.motion'
export function useMotionPreference() {
  const manualReduced = ref(false)
  const systemReduced = ref(false)
  let media: MediaQueryList | undefined
  try { manualReduced.value = localStorage.getItem(key) === 'reduced' } catch { /* optional preference */ }
  const reduced = computed(() => manualReduced.value || systemReduced.value)
  const updateSystem = () => { systemReduced.value = media?.matches ?? false }
  onMounted(() => {
    media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    updateSystem()
    media?.addEventListener('change', updateSystem)
  })
  onBeforeUnmount(() => media?.removeEventListener('change', updateSystem))
  function toggle() {
    if (systemReduced.value) return
    manualReduced.value = !manualReduced.value
    try { localStorage.setItem(key, manualReduced.value ? 'reduced' : 'full') } catch { /* page preference still works */ }
  }
  return { reduced, systemReduced, toggle }
}
