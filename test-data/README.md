# 本地测试资料

`private/` 已被 Git 忽略，仅用于本机已获授权、不可再分发的测试资料。

用于资料提取和 AI 候选生成检查的两本真实 PDF 位于 `private/books/`。仓库自动化测试仍必须使用合成样本，确保干净克隆可复现，且不依赖受版权保护或私有的文件。

完成打包后，可在本机运行以下命令走查两本真实书的首次导入、搜索、AI 设置、目标图谱与发送确认流程：

```powershell
npm.cmd run smoke:documents -- --review-private-books
```

走查使用临时用户资料库，并在实际上传前停止。截图和结构化会话记录写入 `private/beginner-review/`，不会进入 Git。
