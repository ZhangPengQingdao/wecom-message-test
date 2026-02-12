
## 附录：配置“工单解析”工作流

除了基础的消息记录，本项目还支持解析特定格式的故障工单。

### 1. 更新数据库
在 Supabase SQL Editor 中运行 `supabase/schema_update_tickets.sql` 中的语句，创建 `tickets` 表。

### 2. 企业微信工作流设置

1.  **新建工作流**：触发条件选择“当机器人收到消息时”。
2.  **添加 AI 节点 (大模型)**：
    *   **Prompt**:
        ```text
        你是一个工单解析助手。请阅读下面的故障报告，并提取为 JSON 格式。
        
        【用户输入】
        {{input}}
        
        【提取要求】
        请严格提取以下字段，如果缺失则留空：
        - report_time (接报时间)
        - reporter (接报人)
        - department (所属工班)
        - arrival_time (到达时间)
        - location (故障地点)
        - problem (故障现象)
        - reason (故障原因)
        - solution (处置措施)
        - fix_time (修复时间)
        - is_fixed (是否完全修复)
        ```
3.  **添加插件节点**:
    *   **插件 URL**: `https://<你的域名>/api/parse-ticket`
    *   **方法**: `POST`
    *   **Headers**: `Authorization: Bearer <你的API_KEY>`
    *   **Body 参数**: 刚才 AI 节点提取出来的 JSON 字段一一对应填入。
