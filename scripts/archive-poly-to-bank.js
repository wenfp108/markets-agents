const fs = require('fs');
const path = require('path');

async function archivePolyData() {
    const today = new Date().toISOString().split('T')[0];
    const ROOT = process.cwd();
    const LOCAL_DATA = path.resolve(ROOT, 'data');
    const BANK_ROOT = path.resolve(ROOT, 'central_bank');

    console.log(`📅 执行归档判定，日期标签: ${today}`);

    const targets = [
        { local: 'strategy', bank: 'polymarket/strategy' },
        { local: 'trends',   bank: 'polymarket/trends' }
    ];

    targets.forEach(t => {
        const sourcePath = path.join(LOCAL_DATA, t.local, today);
        const targetPath = path.join(BANK_ROOT, t.bank, today);
        const parentDir = path.join(LOCAL_DATA, t.local);

        // 确保父目录存在且有 .gitkeep 占用位置
        if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
        fs.writeFileSync(path.join(parentDir, '.gitkeep'), ''); 

        if (fs.existsSync(sourcePath)) {
            const files = fs.readdirSync(sourcePath).filter(f => f.endsWith('.json'));
            
            if (files.length > 0) {
                if (!fs.existsSync(targetPath)) {
                    fs.mkdirSync(targetPath, { recursive: true });
                }

                files.forEach(file => {
                    const srcFile = path.join(sourcePath, file);
                    const destFile = path.join(targetPath, file);
                    
                    fs.copyFileSync(srcFile, destFile);
                    if (fs.existsSync(destFile)) {
                        fs.unlinkSync(srcFile); // 删除本地文件
                        console.log(`✅ [${t.local}] 归档成功并删除原文件: ${file}`);
                    }
                });

                // 如果今日目录空了，将其删除以保持整洁
                if (fs.readdirSync(sourcePath).length === 0) {
                    fs.rmdirSync(sourcePath);
                }
            } else {
                console.log(`📭 [${t.local}] 今日无待归档文件。`);
            }
        }
    });
}

archivePolyData().catch(console.error);
