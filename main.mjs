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
    defaultViewport: { width: 1440, height: 900 }, // 使用桌面分辨率，防止布局变手机版
    args,
})

const [page] = await browser.pages()
const userAgent = await browser.userAgent()
await page.setUserAgent(userAgent.replace('Headless', ''))

// 开启日志以便调试
page.on('console', msg => console.log('PAGE LOG:', msg.text()));

const recorder = await page.screencast({ path: 'recording.webm' })

try {
    // --- 登录部分 ---
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
    console.log('2. 登录成功，等待页面完全加载...')
    
    // 给点时间让 Dashboard 数据加载出来（有时候列表是异步加载的）
    await setTimeout(5000)

    // ==========================================
    // ▼▼▼ 核心修改：智能查找并点击按钮 ▼▼▼
    // ==========================================
    console.log('3. 正在寻找蓝色按钮...')

    // 1. 找到页面上所有蓝色按钮
    const blueButtons = await page.$$('button.bg-blue-600, a.bg-blue-600') // 同时找 button 和 a 标签

    if (blueButtons.length === 0) {
        throw new Error('页面上居然没有找到任何蓝色按钮！可能页面结构变了。')
    }

    console.log(`-> 找到了 ${blueButtons.length} 个蓝色按钮，正在分析...`)

    let targetBtnIndex = -1;

    // 2. 遍历打印它们的文字，帮你确认脚本到底想点谁
    for (let i = 0; i < blueButtons.length; i++) {
        // 获取按钮文字
        const text = await page.evaluate(el => el.innerText.trim(), blueButtons[i]);
        // 检查是否可见
        const isVisible = await blueButtons[i].boundingBox() !== null;
        
        console.log(`   [按钮 ${i}] 文字: "${text}" | 可见性: ${isVisible ? '显示' : '隐藏'}`);
        
        // 逻辑：如果你原本想点第2个，我们就暂定目标是 index 1
        // 如果你想点包含特定文字的按钮（比如 "Extend"），请告诉我，我可以改这里
    }

    // 默认尝试点击第 2 个可见的按钮（对应你之前的 nth-child(2)）
    // 如果列表里第1个是隐藏的，第2个才是显示的，这里可能需要调整
    // 这里我们假设你要点列表里的【第2个】（索引为1）
    if (blueButtons.length >= 2) {
        targetBtnIndex = 1; 
    } else {
        targetBtnIndex = 0; // 如果只有一个，就点第一个
    }

    console.log(`-> 决定点击 [按钮 ${targetBtnIndex}]...`)
    
    // 3. 使用【强力点击】模式 (evaluate click)
    // 这比 page.click() 更稳，因为它直接在浏览器内部触发点击事件
    await page.evaluate(el => el.click(), blueButtons[targetBtnIndex]);

    console.log('-> 按钮已点击！等待 3 秒让弹窗出现...')
    await setTimeout(3000)

    // ==========================================
    // ▼▼▼ 这里的下拉框代码保持不变 ▼▼▼
    // ==========================================
    console.log('4. 正在扫描下拉框...')
    
    const found = await page.evaluate(() => {
        const selects = Array.from(document.querySelectorAll('select'));
        for (const s of selects) {
            // 只要包含 svortex 或 1873 就认为是目标
            if (s.innerHTML.includes('svortex') || s.innerHTML.includes('1873') || s.innerHTML.includes('选择订单')) {
                 if (!s.id) s.id = 'auto-select-' + Math.random().toString(36).substr(2,9);
                 let val = '';
                 // 优先选第2个选项，没有则选第1个
                 if (s.options.length > 1) val = s.options[1].value;
                 else if (s.options.length > 0) val = s.options[0].value;
                 
                 return { id: s.id, val: val };
            }
        }
        return null;
    });

    if (found) {
        console.log(`-> 找到目标下拉框 (ID: ${found.id})，准备选择值: ${found.val}`)
        await page.select(`select#${found.id}`, found.val)
        console.log('-> 成功选中订单！')
        
        // 如果选中后还需要点确定按钮，请在这里加代码
        // await page.click('button.btn-success') 
    } else {
        console.error('!!! 依然没找到下拉框。这意味着按钮点击后并没有弹出预期的窗口。')
        throw new Error('Popup did not open')
    }

    console.log('脚本流程结束')

} catch (e) {
    console.error('发生错误:', e)
    await page.screenshot({ path: 'error.png', fullPage: true })
    process.exitCode = 1
} finally {
    await setTimeout(2000)
    await recorder.stop()
    await browser.close()
}
