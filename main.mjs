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
    defaultViewport: { width: 1440, height: 900 }, 
    args,
})

const [page] = await browser.pages()
const userAgent = await browser.userAgent()
await page.setUserAgent(userAgent.replace('Headless', ''))
// 忽略多余的日志，只看关键信息
// page.on('console', msg => console.log('PAGE LOG:', msg.text())); 

const recorder = await page.screencast({ path: 'recording.webm' })

try {
    // --- 2. 登录流程 ---
    if (process.env.PROXY_SERVER) {
        const { username, password } = new URL(process.env.PROXY_SERVER)
        if (username && password) await page.authenticate({ username, password })
    }

    console.log('1. 登录中...')
    await page.goto('https://svortex.ru/login', { waitUntil: 'networkidle2', timeout: 60000 })
    
    await page.waitForSelector('input#username')
    await page.type('input#username', process.env.EMAIL)
    await page.type('input#password', process.env.PASSWORD)
    
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.click('button.btn-primary')
    ])
    console.log('2. 登录成功，等待 Dashboard 加载...')
    await setTimeout(5000) 

    // --- 3. 点击蓝色按钮 (复用之前的成功逻辑) ---
    console.log('3. 寻找并点击蓝色操作按钮...')
    const blueButtons = await page.$$('button.bg-blue-600, a.bg-blue-600') 
    
    if (blueButtons.length === 0) throw new Error('未找到蓝色按钮！')
    
    // 默认点击第2个 (index 1)，如果只有一个则点击第1个
    const targetBtnIndex = blueButtons.length >= 2 ? 1 : 0;
    
    // 使用强力点击
    await page.evaluate(el => el.click(), blueButtons[targetBtnIndex]);
    console.log(`-> 已点击第 ${targetBtnIndex + 1} 个蓝色按钮，等待弹窗...`)
    await setTimeout(3000)

    // --- 4. 自动选择下拉框 (复用之前的成功逻辑) ---
    console.log('4. 正在扫描并选择下拉框...')
    
    const found = await page.evaluate(() => {
        const selects = Array.from(document.querySelectorAll('select'));
        for (const s of selects) {
            // 关键词匹配
            if (s.innerHTML.includes('svortex') || s.innerHTML.includes('1873') || s.innerHTML.includes('选择订单')) {
                 if (!s.id) s.id = 'auto-select-' + Math.random().toString(36).substr(2,9);
                 let val = '';
                 if (s.options.length > 1) val = s.options[1].value; // 选第2个
                 else if (s.options.length > 0) val = s.options[0].value;
                 return { id: s.id, val: val };
            }
        }
        return null;
    });

    if (found) {
        console.log(`-> 找到下拉框，选中 Value: ${found.val}`)
        await page.select(`select#${found.id}`, found.val)
        
        // 稍微等一下，确保选中后UI刷新（比如按钮变亮）
        await setTimeout(1000) 
    } else {
        throw new Error('弹窗未弹出或找不到下拉框！')
    }

    // --- 5. 新增：点击最后的确认按钮 ---
    console.log('5. 寻找并点击最后的确认按钮...')
    const finalBtnSelector = '.flex:nth-child(6) > .wemx-btn-primary'
    
    // 等待按钮出现
    await page.waitForSelector(finalBtnSelector, { timeout: 10000 })
    
    // 点击它
    await page.locator(finalBtnSelector).click()
    console.log('-> 最终按钮点击成功！')
    
    console.log('✅ 所有流程执行完毕！')

} catch (e) {
    console.error('❌ 发生错误:', e)
    await page.screenshot({ path: 'error.png', fullPage: true })
    process.exitCode = 1
} finally {
    await setTimeout(2000)
    await recorder.stop()
    await browser.close()
}
