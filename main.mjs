import puppeteer from 'puppeteer'
import { setTimeout } from 'node:timers/promises'

// --- 1. 浏览器启动配置 ---
const args = ['--no-sandbox', '--disable-setuid-sandbox']
if (process.env.PROXY_SERVER) {
    const proxy_url = new URL(process.env.PROXY_SERVER)
    proxy_url.username = ''
    proxy_url.password = ''
    args.push(`--proxy-server=${proxy_url}`.replace(/\/$/, ''))
}

const browser = await puppeteer.launch({
    defaultViewport: { width: 1080, height: 1024 },
    args,
})
const [page] = await browser.pages()
const userAgent = await browser.userAgent()
await page.setUserAgent(userAgent.replace('Headless', ''))
const recorder = await page.screencast({ path: 'recording.webm' })

try {
    // --- 2. 代理认证 (如果有配置) ---
    if (process.env.PROXY_SERVER) {
        const { username, password } = new URL(process.env.PROXY_SERVER)
        if (username && password) {
            await page.authenticate({ username, password })
        }
    }

    // ==========================================
    // ▼▼▼ 核心业务逻辑 ▼▼▼
    // ==========================================

    console.log('1. 正在访问登录页面...')
    await page.goto('https://svortex.ru/login', { 
        waitUntil: 'networkidle2',
        timeout: 60000 
    })

    console.log('2. 正在输入账号密码...')
    // 按照你的要求，使用 input#username 和 input#password
    // 这里使用 waitForSelector 确保输入框已经加载出来
    await page.waitForSelector('input#username')
    await page.locator('input#username').fill(process.env.EMAIL) // 注意：确保 Secrets 里的 EMAIL 存的是你的用户名
    
    await page.waitForSelector('input#password')
    await page.locator('input#password').fill(process.env.PASSWORD)

    console.log('3. 点击登录并等待跳转...')
    // 【关键点】使用 Promise.all 并行处理“点击”和“等待跳转”
    // 这样可以避免点击后页面瞬间跳转，导致脚本错过了等待信号
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }), // 等待网络空闲（跳转完成）
        page.locator('button.btn-primary').click()             // 点击登录按钮
    ])

    console.log('4. 登录成功，正在寻找目标按钮...')
    
    // 按照你的要求：点击 button.bg-blue-600:nth-child(2)
    const targetSelector = 'button.bg-blue-600:nth-child(2)'
    
    // 先等待该按钮出现在页面上 (设置 15秒超时)
    await page.waitForSelector(targetSelector, { timeout: 15000 })
    
    console.log('找到按钮，执行点击...')
    await page.locator(targetSelector).click()
    
    console.log('操作完成！')

    // ==========================================
    // ▲▲▲ 业务逻辑结束 ▲▲▲
    // ==========================================

} catch (e) {
    console.error('发生错误:', e)
    // 截图保存错误现场，方便在 GitHub Artifacts 中查看
    await page.screenshot({ path: 'error.png' })
    // 抛出错误以确保 Action 显示为失败
    process.exitCode = 1
} finally {
    console.log('脚本即将关闭...')
    await setTimeout(5000) // 等待 5 秒确保点击后的请求发送出去
    await recorder.stop()
    await browser.close()
}
