const axios = require('axios');

export default async function handler(req, res) {
  try {
    const { GITHUB_TOKEN, REPO_OWNER, REPO_NAME, CRON_SECRET } = process.env;

    // 🔒 验证密码
    if (req.query.key !== CRON_SECRET) {
      return res.status(401).json({ error: '⛔ Unauthorized' });
    }

    // 🌟 核心指令集
    const templates = [
      { core: "Gold" }, 
      { core: "Fed" },
      { core: "Bitcoin" }
    ];

    const headers = { 
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://polymarket.com/'
    };

    let scoutedSlugs = new Set();
    let debugInfo = []; // 用于记录抓取过程

    // 🚀 第一阶段：广撒网 (Scouting)
    for (const t of templates) {
      // 这里的 limit=10 控制每个词抓多少个，想看更多可以改成 20
      const url = `https://gamma-api.polymarket.com/markets?q=${encodeURIComponent(t.core)}&active=true&closed=false&limit=10`;
      const resp = await axios.get(url, { headers });
      const items = resp.data || [];

      debugInfo.push(`Search [${t.core}]: found ${items.length} items`);

      items.forEach(item => {
        // 只要有 slug 就抓，不做任何过滤！
        if (item.eventSlug || item.slug) {
             scoutedSlugs.add(item.eventSlug || item.slug);
        }
      });
    }

    // 🚀 第二阶段：抓取详情 (Fetching)
    let finalReport = [];
    for (const slug of scoutedSlugs) {
      try {
        const eventResp = await axios.get(`https://gamma-api.polymarket.com/events?slug=${slug}`, { headers });
        const event = eventResp.data[0];
        if (!event || !event.markets) continue;

        let analysis = {};
        event.markets.forEach(m => {
            // 只要有价格就抓
            if (!m.outcomePrices) return;
            
            const prices = JSON.parse(m.outcomePrices);
            const outcomes = JSON.parse(m.outcomes) || ["Yes", "No"];
            let signals = prices.map((p, i) => `${outcomes[i]}: ${(Number(p)*100).toFixed(0)}%`);
            
            const date = m.endDate ? m.endDate.split("T")[0] : "LongTerm";
            if (!analysis[date]) analysis[date] = [];
            
            // 📝 生成最原始的数据条目
            analysis[date].push(`[${m.groupItemTitle || m.question}] ${signals.join(" | ")} (Vol: $${Math.round(m.volume)})`);
        });

        if (Object.keys(analysis).length > 0) {
            finalReport.push({ 
                title: event.title, 
                total_vol: `$${Math.round(event.volume)}`, 
                data: analysis 
            });
        }
      } catch (e) {
          console.error(`Error fetching slug ${slug}:`, e.message);
      }
    }

    // 🚀 第三阶段：生成文件名与推送
    const now = new Date();
    const isoString = now.toISOString();
    const datePart = isoString.split('T')[0];
    const timePart = isoString.split('T')[1].split('.')[0].replace(/:/g, '-');
    
    // 改名：Finance_RAW_年-月-日_时-分-秒
    const fileName = `Finance_RAW_${datePart}_${timePart}.json`;
    const path = `data/strategy/${datePart}/${fileName}`;
    
    // 如果还是空的，把调试信息写进去，方便看看是哪里出了问题
    const contentData = finalReport.length > 0 ? finalReport : [{ info: "No Data", debug: debugInfo }];

    await axios.put(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
      message: `UCIP Raw Data: ${fileName}`,
      content: Buffer.from(JSON.stringify(contentData, null, 2)).toString('base64')
    }, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } });

    res.status(200).send(`✅ V8.6 原始数据版完成！捕获 ${finalReport.length} 条数据。`);
  } catch (err) {
    console.error(err);
    res.status(500).send(`❌ Error: ${err.message}`);
  }
}
