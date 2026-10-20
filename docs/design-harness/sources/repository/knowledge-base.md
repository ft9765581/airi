---
tags: [现状]
---

# 知识库已有检索契约和 BM25 原型，但没有多用户数据模型

共享 UI 已支持 Dify 外部知识库检索契约。`medical-kb` 原型可读取 Markdown 和文本文件，并在内存中建立 BM25 索引。该原型只使用一个全局 API Key，目录名直接充当知识库 ID。它没有用户身份、文档元数据、持久化索引、增量更新或删除流程。来源：[`knowledge-base.ts`](../../../../packages/stage-ui/src/libs/knowledge-base.ts)、[`README.md`](../../../../medical-kb/README.md)、[`kb_server.py`](../../../../medical-kb/kb_server.py)。
