import puppeteer from 'puppeteer'
import { setTimeout } from 'node:timers/promises'

const args = ['--no-sandbox', '--disable-setuid-sandbox']
if (process.env.PROXY_SERVER) {
    const proxy_url = new URL(process.env.PROXY_SERVER)
    proxy_url.username = ''
    proxy_url.password = ''
    args.push(`--proxy-server=${proxy_url}`.replace(/\/$/, ''))
}

const browser = await puppeteer.launch({
    defaultViewport: { width: 1280, height: 1024 }, // 稍微加大窗口，防止布局挤压
    args,
})

const [page] = await browser.pages()
const userAgent = await browser.userAgent()
await page.setUserAgent(userAgent.replace('Headless', ''))
const recorder = await page.screencast({ path: 'recording.webm' })

try {
    if (process.env.PROXY_SERVER) {
        const { username, password } = new URL(process.env.PROXY_SERVER)
        if (username && password) await page.authenticate({ username, password })
    }

    console.log('1. 登录中...')
    await page.goto('https://svortex.ru/login', { waitUntil: 'networkidle2', timeout: 60000 })
    
    await page.waitForSelector('input#username')
    await page.type('input#username', process.env.EMAIL)
    await page.type('input#password', process.env.PASSWORD) // 使用 type 代替 fill 兼容性更好
    
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.click('button.btn-primary')
    ])
    console.log('2. 登录成功')

    // --- 关键步骤：点击蓝色按钮 ---
    const btnSelector = 'button.bg-blue-600:nth-child(2)'
    try {
        await page.waitForSelector(btnSelector, { timeout: 10000 })
        console.log('-> 找到蓝色按钮，准备点击...')
        // 强制多等一下，防止页面JS没挂载好
        await setTimeout(2000) 
        await page.click(btnSelector)
        console.log('-> 按钮已点击')
    } catch (err) {
        console.error('!!! 警告：没找到指定的蓝色按钮，尝试寻找页面上所有蓝色按钮...')
        // 备用方案：点击页面上看到的第一个包含 "bg-blue-600" 的按钮
        const buttons = await page.$$('button.bg-blue-600')
        if (buttons.length > 0) {
            console.log(`-> 发现 ${buttons.length} 个蓝色按钮，点击第 2 个（索引1）...`)
            if (buttons[1]) await buttons[1].click()
            else await buttons[0].click()
        } else {
            throw new Error('页面上找不到任何蓝色按钮！')
        }
    }

    console.log('3. 等待弹窗加载 (5秒)...')
    await setTimeout(5000) // 给足时间让弹窗出来

    // --- 关键步骤：智能查找下拉框 ---
    console.log('4. 正在全页面扫描下拉框...')

    // 不通过 class 找，而是通过内容找
    const targetSelectDetails = await page.evaluate(() => {
        // 获取所有 select 标签
        const selects = Array.from(document.querySelectorAll('select'));
        
        // 遍历每一个 select，看它的选项里有没有我们要的关键词
        for (const select of selects) {
            // 这里的关键词 'svortex' 来自你提供的 html
            // 如果你的订单号变了，但都包含 svortex，这里就能匹配上
            if (select.innerHTML.includes('svortex') || select.innerHTML.includes('1873')) {
                
                // 找到了！记录它的特征以便 puppeteer 操作
                // 如果它没有 ID 或 Class，我们就给它加一个临时 ID
                if (!select.id) select.id = 'found-by-script-' + Math.random().toString(36).substr(2, 9);
                
                // 获取第二个选项的值
                let targetValue = '';
                if (select.options.length > 1) {
                    targetValue = select.options[1].value;
                }
                
                return { found: true, id: select.id, value: targetValue };
            }
        }
        return { found: false };
    });

    if (targetSelectDetails.found) {
        console.log(`-> 成功定位到下拉框 (ID: ${targetSelectDetails.id})`)
        console.log(`-> 目标值: ${targetSelectDetails.value}`)
        
        if (targetSelectDetails.value) {
            await page.select(`select#${targetSelectDetails.id}`, targetSelectDetails.value)
            console.log('-> 下拉框选择成功！')
        } else {
            console.error('-> 下拉框找到了，但里面没有足够的选项！')
        }
    } else {
        console.error('!!! 错误：扫描了整个页面，没有找到包含 "svortex" 或 "1873" 的下拉框。')
        
        // --- 调试信息：打印页面结构 ---
        console.log('--- 页面当前HTML结构 (前1000字符) ---')
        const bodyHTML = await page.evaluate(() => document.body.innerHTML.substring(0, 1000));
        console.log(bodyHTML)
        console.log('-------------------------------------')
        
        throw new Error('无法找到目标下拉框，请检查截图 error.png 确认弹窗是否已打开。')
    }

    console.log('脚本执行完毕')

} catch (e) {
    console.error('发生错误:', e)
    await page.screenshot({ path: 'error.png', fullPage: true })
    process.exitCode = 1
} finally {
    await setTimeout(2000)
    await recorder.stop()
    await browser.close()
}
