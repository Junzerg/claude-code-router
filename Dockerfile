# 多阶段构建 Dockerfile for Claude Code Router

# 阶段 1: 构建阶段
FROM node:20-bullseye AS builder

WORKDIR /app

# 安装 pnpm
RUN npm install -g pnpm

# 复制 package 文件
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ ./packages/

# 安装依赖
RUN pnpm install --frozen-lockfile

# 构建项目
RUN pnpm build

# 阶段 2: 运行阶段
FROM node:20-bullseye-slim

WORKDIR /app

# 安装必要的系统依赖
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 创建非 root 用户
RUN useradd -m -u 1000 -s /bin/bash claude

# 从构建阶段复制构建产物
COPY --from=builder --chown=claude:claude /app/dist ./dist
COPY --from=builder --chown=claude:claude /app/package.json ./
COPY --from=builder --chown=claude:claude /app/node_modules ./node_modules

# 创建配置目录
RUN mkdir -p /root/.claude-code-router/logs && \
    chown -R claude:claude /root/.claude-code-router

# 切换到非 root 用户
USER claude

# 暴露端口
EXPOSE 3456

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3456/health || exit 1

# 启动命令
CMD ["node", "dist/cli.js", "start"]
