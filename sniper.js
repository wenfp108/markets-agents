const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const pathLocal = require('path'); // 重命名避免冲突

// ==========================================
// 0. 策略引擎 (保持原样)
// ==========================================
const MASTERS = {
    TALEB: (m, prices) => {
        const isTail = prices.some(p => Number(p) < 0.05 || Number(p) > 0.95);
        return (isTail && Number(m.liquidity) > 5000) ? 'TAIL_RISK' : null;
    },
    SOROS: (m) => {
        const change = Math.abs(Number(m.oneDayPriceChange || 0));
        const vol24 = Number(m.volume24hr || 0);
        return (vol24 > 10000 && change > 0.05) ? 'REFLEXIVITY_TREND' : null;
    },
    MUNGER: (m) => {
        const spread = Number(m.spread || 1);
        const vol = Number(m.volume || 0);
        return (vol > 50000 && spread < 0.01) ? 'HIGH_CERTAINTY' : null;
    },
    NAVAL: (m, category) => {
        const vol = Number(m.volume || 0);
        return (category === 'TECH' && vol > 20000) ? 'TECH_LEVERAGE' : null;
    }
};

// ==========================================
// 1. 目录分类
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
    return 'WORLD'; 
}

// ==========================================
// 2. 获取指令 (含去重)
// ==========================================
async function fetchQuestionsFromIssues() {
    const token = process.env.MY_PAT || process.env.GITHUB_TOKEN;
    const COMMAND_REPO = "wenfp108/Central-Bank"; 
    const issuesUrl = `https://api.github.com/repos/${COMMAND_REPO}/issues?state=open&per_page=100`;
    
    try {
        console.log("📡 Connecting to Central-Bank command center...");
        const resp = await axios.get(issuesUrl, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' }
        });

        const questions = resp.data
            .filter(issue => issue.title.toLowerCase().includes('[poly]'))
            .map(issue => issue.title.replace(/\[poly\]/gi, '').trim());
            
        const uniqueQuestions = [...new Set(questions)];
        console.log(`✅ Tactical link active. ${uniqueQuestions.length} unique [poly] targets acquired.`);
        return uniqueQuestions;
    } catch (e) {
        console.error("❌ Link failed: Check MY_PAT permissions.");
        return [];
    }
}

// ==========================================
// 3. 生成查询 (3天/2月/2年)
// ==========================================
async function generateQueries() {
    const rawTemplates = await fetchQuestionsFromIssues();
    if (rawTemplates.length === 0) return [];

    const now = new Date();
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    
    const targetDates = [];
    for (let i = 0; i < 3; i++) {
        const d = new Date(now);
        d.setDate(now.getDate() + i);
        targetDates.push({
            str: `${months[d.getMonth()]} ${d.getDate()}`, 
            year: d.getFullYear()
        });
    }

    const currMonthIndex = now.getMonth();
    const nextMonthIndex = (currMonthIndex + 1) % 12;
    const nextNextMonthIndex = (currMonthIndex + 2) % 12;

    const currMonthStr = months[currMonthIndex];
    const nextMonthStr = months[nextMonthIndex];
    const nextNextMonthStr = months[nextNextMonthIndex];

    const currentYearVal = now.getFullYear();
    const nextYearVal = currentYearVal + 1;

    const nextMonthYear = nextMonthIndex < currMonthIndex ? currentYearVal + 1 : currentYearVal;
    const nextNextMonthYear = nextNextMonthIndex < currMonthIndex ? currentYearVal + 1 : currentYearVal;

    let finalQueries = [];
    
    rawTemplates.forEach(template => {
        if (template.includes("{date}")) {
            targetDates.forEach(dateObj => {
                let q = template.replace(/{date}/g, dateObj.str)
                                .replace(/{year}/g, String(dateObj.year)) 
                                .replace(/{month}/g, currMonthStr)
                                .replace(/{next_month}/g, nextMonthStr);
                finalQueries.push({ query: q, originalTitle: template });
            });
        }
        else if (template.includes("{month}") || template.includes("{next_month}")) {
            let q1 = template.replace(/{month}/g, currMonthStr)
                             .replace(/{next_month}/g, nextMonthStr)
                             .replace(/{year}/g, String(currentYearVal));
            finalQueries.push({ query: q1, originalTitle: template });

            let q2 = template.replace(/{month}/g, nextMonthStr)
                             .replace(/{next_month}/g, nextNextMonthStr)
                             .replace(/{year}/g, String(nextMonthYear));
            finalQueries.push({ query: q2, originalTitle: template });
        } 
        else if (template.includes("{year}")) {
            let q1 = template.replace(/{year}/g, String(currentYearVal));
            finalQueries.push({ query: q1, originalTitle: template });

            let q2 = template.replace(/{year}/g, String(nextYearVal));
            finalQueries.push({ query: q2, originalTitle: template });
        }
        else {
            finalQueries.push({ query: template, originalTitle: template });
        }
    });

    return finalQueries;
}

// ==========================================
// 4. 执行搜索 (实时去重)
// ==========================================
async function getSlugs() {
    const queryObjects = await generateQueries();
    if (queryObjects.length === 0) return [];

    const results = []; 
    const discoveredSlugs = new Set();
    
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined 
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    for (const obj of queryObjects) {
        try {
            console.log(`[SCOUTING] Searching: "${obj.query}"`); 
            await page.goto(`https://polymarket.com/search?q=${encodeURIComponent(obj.query)}`, { waitUntil: 'networkidle2', timeout: 25000 });
            
            const slug = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a[href^="/event/"]'));
                for (const link of links) {
                    const href = link.getAttribute('href');
                    const parts = href.split('/');
                    const potentialSlug = parts.pop() || parts.pop();
                    if (potentialSlug !== 'live' && potentialSlug !== 'news' && potentialSlug !== 'activity') {
                        return potentialSlug;
                    }
                }
                return null;
            });
            
            if (slug) {
                if (discoveredSlugs.has(slug)) {
                    console.log(`[SKIP] Duplicate target found: ${slug}`);
                } else {
                    discoveredSlugs.add(slug);
                    results.push({ slug: slug, originalTitle: obj.originalTitle });
                    console.log(`[MATCH] ✅ Target identified: ${slug}`);
                }
            } else {
                console.log(`[FAIL] ❌ No intel found.`);
            }
        } catch (e) { console.log(`[SKIP] Search timeout.`); }
    }
    await browser.close();
    return results;
}

// ==========================================
// 5. 数据同步
// ==========================================
async function syncData() {
    const REPO_OWNER = process.env.REPO_OWNER || process.env.GITHUB_REPOSITORY_OWNER;
    let REPO_NAME = process.env.REPO_NAME;
    if (!REPO_NAME && process.env.GITHUB_REPOSITORY) {
         REPO_NAME = process.env.GITHUB_REPOSITORY.split('/')[1];
    }
    const TOKEN = process.env.MY_PAT || process.env.GITHUB_TOKEN;
    if (!TOKEN) return console.log("❌ Missing Secrets! (MY_PAT required)");
    
    const taskResults = await getSlugs();
    if (taskResults.length === 0) return console.log("No data to sync.");

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
                if (totalVol < 10 && liq < 10) return; 
                
                let prices = [], outcomes = [];
                try {
                    prices = JSON.parse(m.outcomePrices);
                    outcomes = JSON.parse(m.outcomes);
                } catch (e) { return; }
                
                let priceStr = outcomes.map((o, i) => `${o}: ${(Number(prices[i]) * 100).toFixed(1)}%`).join(" | ");
                
                const category = getCategory(task.originalTitle);
                const masterTags = [];
                for (const [name, logic] of Object.entries(MASTERS)) {
                    const tag = logic(m, prices, category);
                    if (tag) masterTags.push(tag);
                }
                if (masterTags.length === 0) masterTags.push("RAW_MARKET");

                processedData.push({
                    slug: task.slug,
                    ticker: m.slug,
                    question: m.groupItemTitle || m.question,
                    eventTitle: event.title,
                    prices: priceStr,
                    volume: Math.round(totalVol),
                    liquidity: Math.round(liq),
                    endDate: m.endDate ? m.endDate.split("T")[0] : "N/A",
                    dayChange: m.oneDayPriceChange ? (Number(m.oneDayPriceChange) * 100).toFixed(2) + "%" : "0.00%",
                    vol24h: Math.round(Number(m.volume24hr || 0)),
                    spread: m.spread ? (Number(m.spread) * 100).toFixed(2) + "%" : "N/A",
                    sortOrder: Number(m.groupItemThreshold || 0),
                    updatedAt: m.updatedAt,
                    engine: "sniper",
                    core_topic: task.originalTitle,
                    category: category, 
                    url: `https://polymarket.com/event/${task.slug}`,
                    strategy_tags: masterTags 
                });
            });
        } catch (e) { console.error(`Fetch Err: ${task.slug}`); }
    }
    
    if (processedData.length === 0) return console.log("No valid data extracted.");
    
    processedData.sort((a, b) => b.volume - a.volume);
    
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const timePart = `${now.getHours().toString().padStart(2, '0')}_${now.getMinutes().toString().padStart(2, '0')}`;
    const fileName = `sniper-${year}-${month}-${day}-${timePart}.json`;
    const datePart = now.toISOString().split('T')[0];
    const path = `data/strategy/${datePart}/${fileName}`;
    
    // 1. 上传云端 (供中央银行收割)
    await axios.put(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
        message: `Structured Sync: ${fileName}`,
        content: Buffer.from(JSON.stringify(processedData, null, 2)).toString('base64')
    }, { headers: { Authorization: `Bearer ${TOKEN}` } });
    
    console.log(`✅ Success: Archived ${processedData.length} structured items to ${path}`);

    // 🔥 2.【核心修改】本地硬盘留底 (防收割机制)
    // 即使云端文件被删，本地这份依然存在，Radar 可以直接读取
    try {
        const localDir = pathLocal.join('data', 'strategy', datePart);
        if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
        fs.writeFileSync(pathLocal.join(localDir, fileName), JSON.stringify(processedData, null, 2));
        console.log(`📍 Intelligence locked in Local Bridge (Safe from Bank harvesting).`);
    } catch (e) { console.error("❌ Local Mirror Failed:", e.message); }
}

// ==========================================
// 6. 执行入口
// ==========================================
(async () => {
    console.log("🚀 Sniper Agent Initializing...");
    try {
        await syncData();
        console.log("🏁 Mission Complete. Exiting.");
        process.exit(0);
    } catch (error) {
        console.error("❌ Fatal Error during execution:", error);
        process.exit(1);
    }
})();
