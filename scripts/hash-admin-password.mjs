import { hashAdminPassword, DEFAULT_ITERATIONS, MAX_ITERATIONS, MIN_ITERATIONS } from './lib/admin-password.mjs'

/**
 * 从标准输入读取管理员密码，输出可直接配置为 ADMIN_PASSWORD_HASH 的哈希。
 * 密码不写入任何文件；请通过交互输入或管道提供，避免出现在命令行历史里。
 */
const iterationsArg = process.argv.slice(2).find((value) => value.startsWith('--iterations='))
const iterations = iterationsArg ? Number(iterationsArg.slice('--iterations='.length)) : DEFAULT_ITERATIONS
if (!Number.isSafeInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
  console.error(`迭代次数必须是 ${MIN_ITERATIONS} 至 ${MAX_ITERATIONS} 之间的整数。`)
  process.exit(2)
}

function readPiped() {
  return new Promise((resolve, reject) => {
    let text = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => { text += chunk })
    process.stdin.on('end', () => resolve(text))
    process.stdin.on('error', reject)
  })
}

function readHidden() {
  process.stderr.write('请输入管理员密码，然后按回车（输入不会显示）：')
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  return new Promise((resolve) => {
    let text = ''
    const finish = (value) => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.off('data', onData)
      process.stderr.write('\n')
      resolve(value)
    }
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') { finish(text); return }
        if (char === '\u0003') { finish(''); process.exit(130) }
        if (char === '\u007f' || char === '\b') {
          if (text) { text = [...text].slice(0, -1).join(''); process.stderr.write('\b \b') }
          continue
        }
        text += char
      }
    }
    process.stdin.on('data', onData)
  })
}

let input
try {
  input = process.stdin.isTTY ? await readHidden() : await readPiped()
} catch (error) {
  console.error(`读取密码失败：${error instanceof Error ? error.message : '未知错误'}`)
  process.exit(1)
}

const password = input.replace(/\r?\n$/, '')
if (!password || password.includes('\n') || password.includes('\r')) {
  console.error('密码不能为空，也不能包含换行。')
  process.exit(2)
}
if (password.length < 16) {
  console.error('提示：密码短于 16 个字符。管理员密码是唯一入口，建议使用随机生成的至少 24 个字符。')
}

const hash = hashAdminPassword(password, iterations)
console.log(hash)
console.error('')
console.error('将上面的完整哈希保存为 Cloudflare Pages 生产环境加密变量 ADMIN_PASSWORD_HASH。')
console.error('本地开发可写入 .dev.vars（已被 .gitignore 忽略），不要把密码或哈希提交到 Git。')
