# 架构

## 对话链路

浏览器确认输入 → Node.js 服务 → 文本模型 → Kokoro 语音合成 → 浏览器播放。

Whisper 负责语音识别。翻译、表达反馈和课程证据通过独立任务生成。

## 模块

| 模块 | 职责 |
|---|---|
| teacher-persona、spoken-persona | 人物设定、模式规则与提示词编译 |
| conversation-director | 对话意图、话题状态和交互节奏 |
| maintained-memory | 记忆来源、有效期、纠正和删除 |
| semantic-memory-retrieval | 语义索引、缓存与相关性筛选 |
| persona-continuity | 人物偏好的连续性记录 |
| relationship-engine | 交互权限与关系状态 |
| curriculum-map、learning-ledger | 能力目标、学习证据与复习安排 |
| lesson-director | 课程任务与进度 |
| temporary-chats、durable-storage | 会话恢复与 SQLite 存储 |
| model-providers、provider-transport | 模型协议、连接与取消 |
| api-usage | 请求和 token 汇总 |

## 数据划分

学习证据、交流记忆、人物偏好和关系状态分别维护。课程评分依据学习证据，人物与关系状态控制交流方式。

长期记忆通过归档整理；临时恢复记录用于继续未结束的会话。记忆检索同时考虑相关性、有效期和上下文预算。

## 头像接口

网页通过同源 iframe 发送 auto-live2d:state 消息，包含口型参数、表情状态、说话状态和动作开关。头像加载完成后发送 emilia:ready。

public/assets/emilia-performance-v4.runtime.html 与配套脚本提供原有爱蜜莉亚角色画面，接收口型、表情和动作状态；图片和背景随应用分发。消息接口校验来源，WebGL 不可用时使用 Canvas 或原角色图片。
