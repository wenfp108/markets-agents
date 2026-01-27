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
      { core: "Gold", type: "monthly" }, // 简化关键词，扩大搜索范围
      { core: "Fed", type: "monthly" },
      { core: "Bitcoin", type: "daily" }
    ];

    const headers = { 
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://polymarket.com/'
    };

    const now = new Date();
    
    // === 📅 1. 简易时间窗口 ===
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    
    // 现在的月份 + 下个月
    const currentMonthIdx = now.getMonth();
    const nextMonthIdx = (currentMonthIdx + 1) % 12;
    const targetMonths = [
        months[currentMonthIdx], shortMonths[currentMonthIdx], 
        months[nextMonthIdx], shortMonths[nextMonthIdx]
    ];

    let scoutedSlugs = new Set();

    // 🚀 第一阶段：广撒网 (Scouting)
    for (const t of templates) {
      const url = `https://gamma-api.polymarket.com/markets?q=${encodeURIComponent(t.core)}&active=true&closed=false&limit=50`;
      const resp = await axios.get(url, { headers });
      const items = resp.data || [];

      items.forEach(item => {
        const title = item.title;
        const vol = Number(item.volume || 0);
        const slug = item.eventSlug || item.slug;

        // 🛡️ 临时调整：成交量 > $0 就抓 (确保你能看到数据)
        if (vol <= 0 || !title || !slug) return;

        // 简单匹配：标题里包含月份即可
        // 比如搜 Gold，只要标题里有 Jan 或 Feb 就抓
        if (targetMonths.some(m => title.includes(m))) {
             scoutedSlugs.add(slug);
        }
      });
    }

    // 🚀 第二阶段：精准抓取 (Fetching)
    let finalReport = [];
    for (const slug of scoutedSlugs) {
      const eventResp = await axios.get(`https://gamma-api.polymarket.com/events?slug=${slug}`, { headers });
      const event = eventResp.data[0];
      if (!event || !event.markets) continue;

      let analysis = {};
      event.markets.forEach(m => {
        if (!m.outcomePrices) return;
        const prices = JSON.parse(m.outcomePrices);
        const outcomes = JSON.parse(m.outcomes) || ["Yes", "No"];
        let signals = prices.map((p, i) => `${outcomes[i]}: ${(Number(p)*100).toFixed(0)}%`);
        
        const date = m.endDate ? m.endDate.split("T")[0] : "LongTerm";
        if (!analysis[date]) analysis[date] = [];
        // 数据格式化
        analysis[date].push(`[${m.groupItemTitle || m.question}] ${signals.join(" | ")} (Vol: $${Math.round(m.volume)})`);
      });

      if (Object.keys(analysis).length > 0) {
        finalReport.push({ 
            title: event.title, 
            total_vol: `$${Math.round(event.volume)}`, 
            data: analysis 
        });
      }
    }

    // 🚀 第三阶段：按你的要求生成文件名
    // 格式：Finance_2026-01-28_14-30-05.json
    const isoString = now.toISOString();
    const datePart = isoString.split('T')[0];
    const timePart = isoString.split('T')[1].split('.')[0].replace(/:/g, '-');
    
    const fileName = `Finance_${datePart}_${timePart}.json`;
    const path = `data/strategy/${datePart}/${fileName}`;
    
    // 如果没有数据，依然写入一个提示信息，证明系统跑通了
    const contentData = finalReport.length > 0 ? finalReport : [{ info: "System running, no matching markets found yet." }];

    await axios.put(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
      message: `UCIP Log: ${fileName}`,
      content: Buffer.from(JSON.stringify(contentData, null, 2)).toString('base64')
    }, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } });

    res.status(200).send(`✅ 成功！文件已生成: ${fileName} (捕获 ${finalReport.length} 条)`);
  } catch (err) {
    console.error(err);
    res.status(500).send(`❌ Error: ${err.message}`);
  }
}
