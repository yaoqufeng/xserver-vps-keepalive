import puppeteer from 'puppeteer'
import { setTimeout } from 'node:timers/promises'

// --- 1. 浏览器启动配置 ---

const args = ['--no-sandbox', '--disable-setuid-sandbox']

if (process.env.PROXY_SERVER) {
    const proxy_url = new URL(process.env.PROXY_SERVER)
    proxy_url.username = ''
    proxy_url.password = ''
    // 修复了正则替换的语法
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
    
    await page.waitForSelector('input#username')
    await page.locator('input#username').fill(process.env.EMAIL) 
    
    await page.waitForSelector('input#password')
    await page.locator('input#password').fill(process.env.PASSWORD)

    console.log('3. 点击登录并等待跳转...')
    
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }), 
        page.locator('button.btn-primary').click()             
    ])

    console.log('4. 登录成功，正在寻找目标按钮...')
    
    // --- 步骤 A: 点击蓝色按钮 ---
    const targetSelector = 'button.bg-blue-600:nth-child(2)'
    
    // 等待按钮出现
    await page.waitForSelector(targetSelector, { timeout: 15000 })
    
    console.log('找到蓝色按钮，执行点击...')
    await page.locator(targetSelector).click()
    
    // --- 步骤 B: 处理下拉框 (Select) ---
    console.log('5. 正在寻找下拉框并自动选择第一个有效订单...')
    
    // 使用精确的选择器定位那个 <select> 元素
    // 这里结合了你给的结构：它是某个 div 下的第一个孩子，且类名为 wemx-form-control
    const selectSelector = 'div:nth-child(1) > select.wemx-form-control'

    // 1. 等待下拉框加载出来
    await page.waitForSelector(selectSelector, { timeout: 15000 })

    // 2. 动态获取下拉框里第2个选项的值 (跳过第1个 "选择订单" 的提示项)
    const valueToSelect = await page.evaluate((selector) => {
        const el = document.querySelector(selector)
        // 确保元素存在且至少有2个选项 (下标0是提示，下标1是我们要的)
        if (el && el.options.length > 1) {
            return el.options[1].value // 获取 value="1873" 或其他动态值
        }
        return null
    }, selectSelector)

    if (valueToSelect) {
        console.log(`-> 识别到目标订单 Value 为: "${valueToSelect}"，正在选中...`)
        // 3. 使用 puppeteer 的 select 方法直接选中
        await page.select(selectSelector, valueToSelect)
    } else {
        console.error('未找到可用的订单选项（列表可能为空）')
        throw new Error('Dropdown option not found')
    }
    
    console.log('操作完成！')

    // ==========================================
    // ▲▲▲ 业务逻辑结束 ▲▲▲
    // ==========================================

} catch (e) {
    console.error('发生错误:', e)
    // 截图保存错误现场
    await page.screenshot({ path: 'error.png' })
    process.exitCode = 1
} finally {
    console.log('脚本即将关闭...')
    await setTimeout(5000) 
    await recorder.stop()
    await browser.close()
}
