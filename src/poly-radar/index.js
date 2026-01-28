const axios = require('axios');
const http = require('http');

// ==========================================
// 1. 优先级排序 (板块归类逻辑)
// ==========================================
const CATEGORY_PRIORITY = [
    "politics", "economy", "finance", "crypto", 
    "tech", "geopolitics", "climate-science", "world"
];

// ==========================================
// 2. 7大板块过滤配置
// ==========================================
const FILTER_CONFIG = {
    "politics": {
        signals: ["election", "nominate", "strike", "shutdown", "fed", "president", "war", "cabinet", "senate", "house"],
        noise: ["tweet", "post", "mention", "says", "follower", "wear", "odds", "poll", "approval"],
    },
    "economy": {
        signals: ["fed", "powell", "rate", "inflation", "cpi", "gdp", "recession", "ecb", "treasury", "job", "unemployment"],
        noise: ["brazil", "turkey", "ranking", "statement"],
    },
    "finance": {
        signals: ["gold", "silver", "s&p", "nasdaq", "oil", "commodity", "largest company", "revenue", "stock"],
        noise: ["acquisition", "merger", "ipo", "earnings call", "dividend"],
    },
    "crypto": {
        signals: ["bitcoin", "ethereum", "solana", "etf", "flow", "price", "hit", "market cap"],
        noise: ["fdv", "launch", "airdrop", "listing", "mint", "floor price", "nft", "meme", "token"],
    },
    "tech": {
        signals: ["ai model", "benchmark", "gemini", "gpt", "nvidia", "apple", "microsoft", "semiconductor", "agi"],
        noise: ["app store", "download", "tiktok", "charizard", "pokemon", "influencer", "game"],
    },
    "geopolitics": {
        signals: ["strike", "ceasefire", "supreme leader", "regime", "invasion", "nuclear", "war", "military", "border"],
        noise: ["costa rica", "thailand", "parliamentary election", "local"],
    },
    "climate-science": {
        signals: ["earthquake", "spacex", "measles", "virus", "pandemic", "temperature", "volcano", "hurricane"],
        noise: ["snow", "inches", "rain", "weather in", "nyc", "washington", "cloud"],
    },
    "world": {
        signals: ["coalition", "prime minister", "eu", "nato", "un", "trade deal"],
        noise: ["us election", "us strike"]
    }
};

// ==========================================
// 3. 辅助模块：一号机去重
// ==========================================
async function generateSniperTargets() {
    const { GITHUB_TOKEN, REPO_OWNER, REPO_NAME } = process.env;
    if (!GITHUB_TOKEN) return [];
    const issuesUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues?state=open&per_page=100`;

    try {
        const resp = await axios.get(issuesUrl, {
            headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' }
        });
        
        const now = new Date();
        const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const currMonth = months[now.getMonth()], nextMonth = months[(now.getMonth() + 1) % 12];
        const currYear = String(now.getFullYear()), currDateStr = `${currMonth} ${now.getDate()}`;

        let specificTargets = [];
        resp.data.forEach(issue => {
            let t = issue.title;
            if (t.includes("{month}") || t.includes("{year}") || t.includes("{date}")) {
                let q1 = t.replace(/{month}/g, currMonth).replace(/{year}/g, currYear).replace(/{date}/g, currDateStr);
                specificTargets.push(normalizeText(q1));
                if (t.includes("{month}")) {
                    let q2 = t.replace(/{month}/g, nextMonth).replace(/{year}/g, currYear).replace(/{date}/g, currDateStr);
                    specificTargets.push(normalizeText(q2));
                }
            } else {
                specificTargets.push(normalizeText(t));
            }
        });
        return specificTargets;
    } catch (e) { return []; }
}

function normalizeText(str) {
    return str.toLowerCase().replace(/[?!]/g, "").replace(/\s+/g, " ").trim();
}

// ==========================================
// 4. 雷达主任务 (结构完全对齐一号机版)
// ==========================================
async function runRadarTask() {
    const { GITHUB_TOKEN, REPO_OWNER, REPO_NAME } = process.env;
    if (!GITHUB_TOKEN) return console.log("❌ Missing Secrets!");

    const sniperBlacklist = await generateSniperTargets();

    console.log("📡 [Radar] Scanning Top 100 Global Markets...");
    const url = `https://gamma-api.polymarket.com/events?limit=100&active=true&closed=false&order=volume24hr&ascending=false`;

    try {
        const resp = await axios.get(url);
        const events = resp.data;
        let trendingData = [];

        events.forEach(event => {
            if (!event.markets) return;

            // --- A. 板块锁定 ---
            const eventTags = event.tags ? event.tags.map(t => t.slug) : [];
            let primaryTag = null;
            for (const cat of CATEGORY_PRIORITY) {
                if (eventTags.includes(cat)) { primaryTag = cat; break; }
            }
            if (!primaryTag) return;

            // --- B. 去重 ---
            const eventTitleClean = normalizeText(event.title);
            if (sniperBlacklist.some(target => eventTitleClean.includes(target) || target.includes(eventTitleClean))) return;

            // --- C. 过滤 ---
            const rules = FILTER_CONFIG[primaryTag];
            if (rules.noise.some(kw => eventTitleClean.includes(kw))) return;
            const isLoose = ["politics", "geopolitics", "world"].includes(primaryTag);
            if (!isLoose && !rules.signals.some(kw => eventTitleClean.includes(kw))) return;

            // --- D. 统一数据提取 (🔥完全按照一号机逻辑修改🔥) ---
            event.markets.forEach(m => {
                if (!m.active || m.closed) return;
                
                const vol24h = Number(m.volume24hr || 0);
                if (vol24h < 10000) return;

                let prices = []; 
                let outcomes = [];
                try {
                    prices = JSON.parse(m.outcomePrices);
                    outcomes = JSON.parse(m.outcomes);
                } catch (e) { return; }

                let priceStr = outcomes.map((o, i) => `${o}: ${(Number(prices[i]) * 100).toFixed(1)}%`).join(" | ");

                trendingData.push({
                    // 1. 基础 ID
                    slug: event.slug,       // 用 event.slug 对应一号机的 slug
                    ticker: m.slug,         // 对应一号机的 ticker
                    
                    // 2. 标题
                    question: m.groupItemTitle || m.question,
                    eventTitle: event.title,
                    
                    // 3. 价格与量
                    prices: priceStr,
                    volume: Math.round(Number(m.volume || 0)),
                    liquidity: Math.round(Number(m.liquidity || 0)),
                    
                    // 4. 时间与变动 (🔥修正：格式与一号机严格一致🔥)
                    endDate: m.endDate ? m.endDate.split("T")[0] : "N/A", // 以前这里漏了 split
                    dayChange: m.oneDayPriceChange ? (Number(m.oneDayPriceChange) * 100).toFixed(2) + "%" : "0.00%",
                    vol24h: Math.round(vol24h),
                    spread: m.spread ? (Number(m.spread) * 100).toFixed(2) + "%" : "N/A", // 以前这里默认是 0.00%，改回 N/A
                    
                    // 5. 排序与更新
                    sortOrder: Number(m.groupItemThreshold || 0), // 以前取的 sortOrder，改成 groupItemThreshold 以对齐
                    updatedAt: m.updatedAt,
                    
                    // 6. 雷达特有字段 (不影响结构，AI 可选读)
                    category: primaryTag.toUpperCase(),
                    url: `https://polymarket.com/event/${event.slug}`
                });
            });
        });

        trendingData.sort((a, b) => b.vol24h - a.vol24h);
        const top30 = trendingData.slice(0, 30);

        if (top30.length > 0) {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth() + 1;
            const day = now.getDate();
            const timePart = `${now.getHours().toString().padStart(2, '0')}_${now.getMinutes().toString().padStart(2, '0')}`;
            
            const fileName = `radar-${year}-${month}-${day}-${timePart}.json`;
            const datePart = now.toISOString().split('T')[0];
            const path = `data/trends/${datePart}/${fileName}`;

            await axios.put(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
                message: `Radar Update: ${fileName}`,
                content: Buffer.from(JSON.stringify(top30, null, 2)).toString('base64')
            }, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } });
            
            console.log(`✅ Radar Success: Filtered & Uploaded ${top30.length} signals to ${path}`);
        } else {
            console.log("⚠️ No high-value signals found.");
        }

    } catch (e) { console.error("❌ Radar Error:", e.message); }
}

http.createServer(async (req, res) => {
    if (req.url === '/run') { runRadarTask(); res.end("Radar Started"); } 
    else { res.end("Woon's Unified Radar is Online"); }
}).listen(7860);
