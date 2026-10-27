import { describe, expect, it } from 'vitest'
import { centsFromInput, money, priceInput } from './format'

describe('人民币输入', () => {
  it('以十进制字符串转换，避免小数乘法误差', () => {
    expect(centsFromInput('0.29')).toBe(29)
    expect(centsFromInput('12.3')).toBe(1230)
    expect(centsFromInput(' 0.00 ')).toBe(0)
    expect(centsFromInput('1000000.00')).toBe(100000000)
    expect(centsFromInput('1000000.01')).toBeNull()
    expect(priceInput(109)).toBe('1.09')
    expect(money(109)).toBe('¥1.09')
  })
  it('拒绝负值、指数、超精度和空输入', () => {
    for (const value of ['-1', '1e2', '1.234', 'Infinity', '', '.5', '0x10']) expect(centsFromInput(value)).toBeNull()
  })
})
