import { onMounted, onUnmounted, ref } from 'vue'

/** Refresh availability at minute boundaries and after returning to a background tab. */
export function useClock() {
  const now = ref(new Date())
  let timer: ReturnType<typeof setInterval> | undefined
  const update = () => { now.value = new Date() }
  onMounted(() => {
    update()
    timer = setInterval(update, 30_000)
    document.addEventListener('visibilitychange', update)
  })
  onUnmounted(() => { clearInterval(timer); document.removeEventListener('visibilitychange', update) })
  return now
}
