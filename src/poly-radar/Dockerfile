# 使用轻量级 Node 环境
FROM node:18-slim

# 设置工作目录
WORKDIR /app

# 先拷贝依赖文件
COPY package.json ./

# 安装 axios
RUN npm install

# 拷贝核心代码
COPY index.js .

# 暴露端口 (虽然这是后台任务，但HF需要暴露端口才能存活)
EXPOSE 7860

# 启动命令
CMD ["node", "index.js"]
