import type { Mode } from '../../shared/types'

export const modeLabels: Record<Mode, string> = { restaurant: '随机选店', dish: '店内选菜', combo: '直接决定' }
export function money(cents: number): string { return `¥${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}` }
export function centsFromInput(value: string): number | null {
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(value.trim())) return null
  const [whole = '0', fraction = ''] = value.trim().split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents <= 100000000 ? cents : null
}
export function priceInput(cents: number): string { return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}` }
export function displayTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}
