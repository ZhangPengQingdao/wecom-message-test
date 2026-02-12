# 企业微信消息记录插件 (Supabase + Vercel)

这是一个轻量级的消息记录服务，旨在接收企业微信机器人转发的消息，并通过 MCP (Model Context Protocol) 协议供 AI 读取上下文。

## 功能特性

1.  **消息接收 (Log API)**: 提供 HTTP 接口供机器人插件调用，将消息存入 Supabase 数据库。
2.  **消息读取 (MCP API)**: 提供符合 MCP 习惯的接口，供 AI (如 Cursor, Windsurf, Coze 等) 读取最近的沟通记录。
3.  **零运维**: 基于 Vercel Serverless Functions 和 Supabase，无需管理服务器。

## 快速开始

### 1. 配置 Supabase 数据库

1.  登录 [Supabase Dashboard](https://supabase.com/dashboard) 创建一个新项目。
2.  进入 **SQL Editor**，运行 `supabase/schema.sql` 中的 SQL 语句创建表结构。
3.  在 **Project Settings -> API** 中获取 `Project URL` 和 `anon public` Key。

### 2. 部署到 Vercel

1.  Fork 或上传本项目代码到 GitHub。
2.  登录 [Vercel](https://vercel.com/) 导入项目。
3.  在 **Environment Variables** 中设置环境变量：
    -   `NEXT_PUBLIC_SUPABASE_URL`: 你的 Supabase Project URL
    -   `NEXT_PUBLIC_SUPABASE_ANON_KEY`: 你的 Supabase anon Key
4.  点击 Deploy 等待部署完成。

### 3. 配置机器人插件

假设你的 Vercel 域名是 `https://your-project.vercel.app`。

#### A. 消息接收插件 (Webhook)
在你的机器人平台（如 LinkAI, Coze 等）添加一个 API 插件：
-   **URL**: `https://your-project.vercel.app/api/log-message`
-   **Method**: `POST`
-   **授权方式 (Authorization)**: `API Key` 或 `Service Token`
    -   **Key**: `Authorization`
    -   **Value**: `Bearer <你的API_SECRET_KEY>`
    -   **或者** 在 Query Parameter 中添加 `api_key=<你的API_SECRET_KEY>`
-   **Body**: 机器人转发的完整 JSON 数据。

**示例请求：**
```json
{
  "content": "你好，帮我查一下天气",
  "sender": "user_123",
  "msg_type": "text"
}
```

#### B. MCP 工具配置
在支持 MCP 的 AI 编辑器或 Agent 中配置：
-   **Tool Name**: `get_recent_messages`
-   **Description**: 获取最近的企业微信聊天记录作为上下文。
-   **API URL**: `https://your-project.vercel.app/api/mcp/messages?limit=20`

## 本地开发

1.  安装依赖：
    ```bash
    npm install
    ```
2.  配置环境变量：
    复制 `.env.local.example` 为 `.env.local` 并填入 Supabase 信息。
3.  启动服务：
    ```bash
    npm run dev
    ```
