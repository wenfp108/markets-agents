const puppeteer = require('puppeteer');
const axios = require('axios');
const http = require('http');

// ==========================================
// ✨ [新增] 1. 智能目录分类器 (对齐二号机逻辑)
// ==========================================
function getCategory(title) {
    const t = title.toLowerCase();
    if (t.includes('fed') || t.includes('rate') || t.includes('cpi') || t.includes('inflation')) return 'ECONOMY';
    if (t.includes('gold') || t.includes('silver') || t.includes('s&p') || t.includes('market') || t.includes('stock')) return 'FINANCE';
    if (t.includes('bitcoin') || t.includes('eth') || t.includes('crypto') || t.includes('btc')) return 'CRYPTO';
    if (t.includes('election') || t.includes('president') || t.includes('senate') || t.includes('cabinet')) return 'POLITICS';
    if (t.includes('war') || t.includes('strike') || t.includes('border') || t.includes('conflict')) return 'GEOPOLITICS';
    if (t.includes('ai') || t.includes('gpt') || t.includes('nvidia') || t.includes('spacex')) return 'TECH';
    if (t.includes('disaster') || t.includes('climate') || t.includes('virus')) return 'SCIENCE';
    return 'WORLD'; // 保底分类
}

// ==========================================
// 2. 从 GitHub Issues 获取配置
// ==========================================
async function fetchQuestionsFromIssues() {
    const { GITHUB_TOKEN, REPO_OWNER, REPO_NAME } = process.env;
    const issuesUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues?state=open&per_page=100`;

    try {
        console.log("📥 Reading questions from GitHub Issues...");
        const resp = await axios.get(issuesUrl, {
            headers: { 
                Authorization: `Bearer ${GITHUB_TOKEN}`, 
                Accept: 'application/vnd.github.v3+json' 
            }
        });
        const questions = resp.data.map(issue => issue.title);
        console.log(`✅ Loaded ${questions.length} active questions from Issues.`);
        return questions;
    } catch (e) {
        console.error("❌ Failed to fetch issues:", e.message);
        return [];
    }
}

// ==========================================
// 3. 智能问题生成器 (支持 {month} 占位符)
// ==========================================
async function generateQueries() {
    const rawTemplates = await fetchQuestionsFromIssues();
    
    // 如果没有 Issue，使用保底默认值
    if (rawTemplates.length === 0) {
        console.log("⚠️ No active Issues found. Using default fallback.");
        return [{ query: `What will Gold (GC) settle at in {month}?`, originalTitle: `What will Gold (GC) settle at in {month}?` }]; 
    }

    const now = new Date();
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const currMonth = months[now.getMonth()];
    const nextMonth = months[(now.getMonth() + 1) % 12];
    const currYear = String(now.getFullYear());
    const currDateStr = `${currMonth} ${now.getDate()}`; 

    // ✨ [修改] 改为存储对象 { query, originalTitle }
    let finalQueries = [];

    rawTemplates.forEach(template => {
        let queriesToAdd = [];
        
        if (template.includes("{month}") || template.includes("{year}") || template.includes("{date}")) {
            let q1 = template.replace(/{month}/g, currMonth)
                             .replace(/{next_month}/g, nextMonth)
                             .replace(/{year}/g, currYear)
                             .replace(/{date}/g, currDateStr);
            queriesToAdd.push(q1);

            if (template.includes("{month}")) {
                let q2 = template.replace(/{month}/g, nextMonth)
                                 .replace(/{next_month}/g, months[(now.getMonth() + 2) % 12])
                                 .replace(/{year}/g, currYear)
                                 .replace(/{date}/g, currDateStr);
                queriesToAdd.push(q2);
            }
        } else {
            queriesToAdd.push(template);
        }

        // 将生成的查询词与原始 Issue 标题绑定
        queriesToAdd.forEach(q => {
            finalQueries.push({
                query: q,
                originalTitle: template // 保留“核心话题”，用于后续 AI 关联
            });
        });
    });

    return finalQueries;
}

// ==========================================
// 4. 模拟搜索 (Puppeteer)
// ==========================================
async function getSlugs() {
    const queryObjects = await generateQueries();
    const results = []; // ✨ [修改] 存储结构化结果 { slug, originalTitle }
    
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome'
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    for (const obj of queryObjects) {
        try {
            console.log(`[SCOUTING] ${obj.query}`);
            await page.goto(`https://polymarket.com/search?q=${encodeURIComponent(obj.query)}`, { waitUntil: 'networkidle2', timeout: 25000 });
            
            const slug = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a[href^="/event/"]'));
                for (const link of links) {
                    const href = link.getAttribute('href');
                    const parts = href.split('/');
                    const potentialSlug = parts.pop() || parts.pop();
                    // 黑名单过滤
                    if (potentialSlug !== 'live' && potentialSlug !== 'news' && potentialSlug !== 'activity') {
                        return potentialSlug;
                    }
                }
                return null;
            });

            if (slug) {
                // ✨ [关键] 只要找到 slug，就把原始话题带上
                results.push({ slug: slug, originalTitle: obj.originalTitle });
                console.log(`[MATCH] ✅ Found: ${slug}`);
            } else {
                console.log(`[FAIL] ❌ No valid slug found for: ${obj.query}`);
            }
        } catch (e) { console.log(`[SKIP] ${obj.query}`); }
    }
    await browser.close();
    
    // 简单去重 (以 slug 为准)
    const uniqueResults = [];
    const seenSlugs = new Set();
    for (const r of results) {
        if (!seenSlugs.has(r.slug)) {
            seenSlugs.add(r.slug);
            uniqueResults.push(r);
        }
    }
    return uniqueResults;
}

// ==========================================
// 5. 数据同步 (🔥核心修改区域🔥)
// ==========================================
async function syncData() {
    const { GITHUB_TOKEN, REPO_OWNER, REPO_NAME } = process.env;
    if (!GITHUB_TOKEN) return console.log("❌ Missing Secrets!");

    const taskResults = await getSlugs();
    let processedData = [];

    for (const task of taskResults) {
        try {
            const resp = await axios.get(`https://gamma-api.polymarket.com/events?slug=${task.slug}`);
            const event = resp.data[0];
            if (!event || !event.markets) continue;

            event.markets.forEach(m => {
                if (!m.active || m.closed || m.archived) return;
                
                const totalVol = Number(m.volume || 0);
                const liq = Number(m.liquidity || 0);
                // 门槛保持: Volume < 10 或 Liquidity < 10 则忽略
                if (totalVol < 10 && liq < 10) return; 

                let prices = [], outcomes = [];
                try {
                    prices = JSON.parse(m.outcomePrices);
                    outcomes = JSON.parse(m.outcomes);
                } catch (e) { return; }

                let priceStr = outcomes.map((o, i) => `${o}: ${(Number(prices[i]) * 100).toFixed(1)}%`).join(" | ");

                // ✨ [重点] 这里完全复制了二号机的结构，并补全了 Category
                processedData.push({
                    // 1. 基础 ID
                    slug: task.slug,                // 对应一号机抓取的 slug
                    ticker: m.slug,                 // 对应 m.slug
                    
                    // 2. 标题
                    question: m.groupItemTitle || m.question,
                    eventTitle: event.title,
                    
                    // 3. 价格与量
                    prices: priceStr,
                    volume: Math.round(totalVol),
                    liquidity: Math.round(liq),
                    
                    // 4. 时间与变动 (🔥 严格对齐二号机修正逻辑)
                    endDate: m.endDate ? m.endDate.split("T")[0] : "N/A",
                    dayChange: m.oneDayPriceChange ? (Number(m.oneDayPriceChange) * 100).toFixed(2) + "%" : "0.00%",
                    vol24h: Math.round(Number(m.volume24hr || 0)),
                    spread: m.spread ? (Number(m.spread) * 100).toFixed(2) + "%" : "N/A",
                    
                    // 5. 排序与更新
                    sortOrder: Number(m.groupItemThreshold || 0),
                    updatedAt: m.updatedAt,

                    // 6. 汇总看板关键字段 (一号机专属身份卡)
                    engine: "sniper",                          // 标记来源
                    core_topic: task.originalTitle,           // 关联 Issue 标题
                    category: getCategory(task.originalTitle), // 自动生成的目录
                    url: `https://polymarket.com/event/${task.slug}` // 方便点击
                });
            });
        } catch (e) { console.error(`Fetch Err: ${task.slug}`); }
    }

    if (processedData.length === 0) return console.log("No valid data found.");

    // 按成交量排序
    processedData.sort((a, b) => b.volume - a.volume);

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const timePart = `${now.getHours().toString().padStart(2, '0')}_${now.getMinutes().toString().padStart(2, '0')}`;

    const fileName = `sniper-${year}-${month}-${day}-${timePart}.json`;
    const datePart = now.toISOString().split('T')[0];
    const path = `data/strategy/${datePart}/${fileName}`;

    await axios.put(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
        message: `Structured Sync: ${fileName}`,
        content: Buffer.from(JSON.stringify(processedData, null, 2)).toString('base64')
    }, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } });
    
    console.log(`✅ Success: Archived ${processedData.length} structured items.`);
}

http.createServer(async (req, res) => {
    if (req.url === '/run') {
        console.log("🚀 Triggered by Action");
        syncData().then(() => console.log("Sync Complete")).catch(e => console.error(e));
        res.end("Run Started");
    } else {
        res.end("Sniper Agent Online");
    }
}).listen(7860);
