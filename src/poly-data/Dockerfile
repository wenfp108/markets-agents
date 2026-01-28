FROM node:20-slim

# 1. 更新系统并安装下载工具
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    --no-install-recommends

# 2. 直接下载 Google Chrome 官方安装包 (这是最稳的方法，不会找不到源)
RUN wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb

# 3. 安装 Chrome (apt 会自动解决所有依赖)
RUN apt-get install -y ./google-chrome-stable_current_amd64.deb \
    && rm google-chrome-stable_current_amd64.deb \
    && rm -rf /var/lib/apt/lists/*

# 4. 设置环境变量
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome

WORKDIR /app

# 5. 安装项目依赖
COPY package.json .
RUN npm install

# 6. 复制其余代码
COPY . .

# 7. 暴露端口并启动
EXPOSE 7860
CMD ["node", "index.js"]
