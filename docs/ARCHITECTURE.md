# 架构

## 运行时边界

```text
React renderer
  → window.openLearnGraph（preload 中的窄类型 API）
  → 明确命名的 graph / learning / session / practice / assessment / tutor / document / candidate / ai / lifecycle IPC
  → GraphService / LearningService / SessionService / PracticeService / AssessmentService / TutorService / DocumentService / CandidateService / AiService（Zod 边界验证）
  → GraphRepository / LearningRepository / SessionRepository / PracticeRepository / AssessmentRepository / TutorRepository / DocumentRepository / CandidateRepository / AiGenerationRepository
  → SQLite（Electron userData）
```

主进程负责窗口、数据库、系统文件选择与其他特权能力；preload 只桥接明确的图谱、学习证据、学习会话、形成性练习、诊断、学习建议、资料导入与生命周期操作；renderer 是不可信 UI。BrowserWindow 启用 `contextIsolation` 和 `sandbox`，关闭 `nodeIntegration`，拒绝任意新窗口和页面导航，并在 HTML 设置 CSP。

## SQLite 决策（ADR-001）

选择 Electron 所带 Node 运行时的官方 `node:sqlite` `DatabaseSync`，而非 `better-sqlite3`。

原因：当前开发环境 Node 24 已实际验证该模块；它使用真正的 SQLite，API 小且同步调用适合仅在主进程执行的 M1 数据量；没有第三方原生扩展，因此不需要 node-gyp、Python、MSVC、预编译二进制或 Electron ABI rebuild，Windows 打包更可靠。代价是应用要求所选 Electron 版本内置 `node:sqlite`；升级 Electron 时，打包和启动烟雾检查必须覆盖此项。

## 持久化策略（ADR-002）

图谱仍以完整文档作为保存输入，并在单个 `BEGIN IMMEDIATE` 事务中写入；但 M2 起节点使用保留 ID 的 upsert，只删除用户真正移除的节点，避免普通结构编辑触发学习证据的级联删除。边按当前文档替换，规模上限由 IPC schema 限定。

## 状态边界（ADR-003）

知识节点只持久化知识结构。M2 将原始学习事件追加到 `learning_evidence`，并在同一事务中更新独立的 `learner_node_states` 投影缓存。读取图谱时，应用结合学习阶段和先修关系确定节点状态：已掌握优先；否则未完成先修会锁定节点；其余节点根据证据显示为学习中或可学习。每个状态都返回可读原因。

没有客观诊断时，`MASTERED` 可由最近一次 4–5 分自评证据产生，并在界面明确标注为自评结论。M3 起，诊断为每个参与概念产生一条带答对数和题目数的 `DIAGNOSTIC_RESULT`；达到 80% 投影为 `MASTERED`，否则投影为 `LEARNING`。最近一次客观诊断优先于之后的自评，重新诊断才会替换客观结论。掌握度始终不写入 `knowledge_nodes`。

## 诊断一致性（ADR-005）

诊断开始时在单个事务中创建 attempt，并复制题目、概念名、解析和选项为快照。renderer 只收到没有正确性标记的选项；评分在 main repository 内依据快照完成。每次选择通过窄 IPC 校验后 upsert 为草稿响应，以支持崩溃/重启恢复；恢复接口只返回所选选项，不返回 `is_correct`。提交在另一个事务中原子 upsert 全部响应、客观 Evidence、learner state 和完成状态。这样题库在诊断期间被修改或删除也不会改变本次评分依据，重复提交和跨题选项会被拒绝。

同一图谱存在 `IN_PROGRESS` 尝试时不能开始另一场诊断，必须先继续或取消，避免并行尝试产生含糊的客观状态。诊断范围由经过 Zod 校验且属于当前图谱、题量合格的节点 ID 集合显式指定；历史列表最多返回最近 100 条，已完成结果始终从不可变快照和响应重建。

## 学习决策边界（ADR-006）

M4A 的 `TutorService` 读取 GraphRepository 投影后的知识与学习状态，并结合分用途题库覆盖及活动流程生成固定动作空间内的建议。纯函数策略优先恢复未完成流程，再按“补强失败诊断 → 补强后重测 → 练习/评估学习中概念 → 学习已解锁概念 → 回顾已掌握图谱”决策，且不会把锁定概念作为目标。

建议按图谱语义状态生成 SHA-256 指纹。相同状态复用已有决策；状态变化时旧决策只标记失效，保留原始理由、依据和用户响应。renderer 必须先通过受校验的 IPC 记录用户响应，再导航到概念或诊断中心。决策本身和采纳行为均不能写 Evidence 或 learner state，因而维持 `decision → user-confirmed execution → Evidence → projection` 的单向边界。

## 学习会话一致性（ADR-007）

M5A 的 `SessionService` 只允许为已解锁、未掌握且具有已保存描述的概念开始 `TEACH / ADVANCE` 会话。开始时复制概念名称、描述和先修状态，避免之后编辑图谱改写学习历史。每次笔记或步骤变化经防抖后写入本机，关闭会话时立即补存；Tutor 在状态指纹中包含活动会话，并优先建议恢复它。

每个图谱只能有一个活动学习会话，并与活动诊断互斥。完成会话原子写入完成证据和投影，但只把没有客观诊断的未开始概念推进到 `LEARNING`；绝不覆盖诊断结论或降低 `MASTERED`。取消只结束活动状态，不生成证据。这样区分了“执行过学习行为”和“已经掌握”的语义。

## 形成性练习边界（ADR-008）

M5B 将题目用途显式分为诊断、练习和通用。`PracticeService` 只读取练习或通用题，并在开始时复制不可变快照。未作答题目通过 preload 时移除正确性；答案提交后由 `PracticeRepository` 按快照评分、写入不可变响应，并只为该题返回反馈。诊断仍要等整场提交后才返回答案，因此练习的即时反馈不会改变诊断接口的保密边界。

完成练习原子写入 `PRACTICE_RESULT`，但练习正确率不直接产生掌握结论。已有 `MASTERED` 或客观诊断投影保持不变，原始练习 Evidence 仍保留并作为 Tutor 重规划依据：失败诊断后的补强完成会转向重新诊断，回顾完成后不会立即重复建议。活动练习、教学会话和诊断互斥；服务层、数据库唯一索引和概念删除保护共同维持一致性。

## 本地资料导入边界（ADR-009）

M6A 的文件选择、读取、散列和解析只在 main 执行。renderer 只能请求打开支持多选、受限扩展名的系统选择器，一次最多选择 20 份资料；main 逐份解析，并仅返回不含本机路径的结构化预览、短期随机 token 及按文件隔离的失败原因。成功项在 renderer 中排成逐本确认队列，单个失败不丢弃其他预览。确认接口只接受 token 与经过 Zod 校验的可编辑元数据。服务在确认时重新核对文件大小、修改时间与内容 SHA-256，并用 SHA-256 唯一约束阻止内容相同的重复资料。预览 token 仅保存在内存中、30 分钟后失效，关闭或放弃批次时主动释放。

提取器是确定性的本地实现：PDF.js 按页提取文本及文档元数据，JSZip 与 XML 解析器按 EPUB package 的 spine 顺序读取章节，纯文本与 Markdown 先检测编码再解码并按标题分节。ZIP 内容不会释放到文件系统；单文件、解压总量、条目数、章节数和提取字符数都有上限。只有图像而没有可靠文本层的 PDF 返回受阻预览并提示后续使用 OCR，不会静默保存空内容。导入确认后，资料与完整章节在单个 SQLite 事务中持久化；这一阶段不调用 AI、网络服务，也不创建知识图谱。

PDF.js 的主模块在 Vite 主进程构建中会变成独立代码块，因此 `vite.main.config.mts` 明确把匹配版本的 `pdf.worker.mjs` 输出到同一目录，提取器以文件 URL 指向该构建产物。升级 PDF.js 或更改打包配置时，必须在正式 EXE 中执行一次 PDF 提取预览，不能只依赖源码单元测试。

已导入资料的详情接口只返回元数据；章节目录、正文和关键词搜索分别走明确命名、经 Zod 验证的 IPC。目录每次返回 50 条，正文每次从指定字符位置读取最多 24,000 个字符，搜索按正文中的字面子串返回前 50 个匹配章节及其位置。这样旧资料无需迁移即可读到全部正文，也不会把整本书一次发送到 renderer。搜索命中可定位到对应 PDF 页码或 EPUB 章节文件与正文位置。

`npm.cmd run smoke:documents` 在隔离临时资料库中启动正式 EXE，经真实 preload/IPC/main/SQLite 路径检查 PDF、EPUB、Markdown、TXT 的预览、确认、重复拦截、异常反馈、重启读取、长资料定位及资料库界面打开，同时覆盖原文选区创建候选、关系审核、原子写入、重启后审核记录保留，以及 AI Key 安全保存、目标图谱/章节范围选择和正文上传确认界面；用 loopback DevTools 临时替换系统文件选择器，不向生产应用添加测试专用接口，也不会发起真实云端请求。其合成样本之外，复杂中文 PDF/EPUB 仍须用授权的真实资料进行人工核对。

## 候选图谱审核边界（ADR-010）

M7A 不从资料自动生成正式节点。renderer 只把用户在已导入正文中选定的字符区间和受验证的候选元数据经窄 IPC 送入 main；`CandidateRepository` 从 SQLite 重新读取原章节，按 Unicode 码点区间重建引用，不接受 renderer 传入的原文快照。候选记录保存资料标题、来源名、章节定位、字符区间和不可变引用；原资料删除后仍保留审核轨迹。

候选概念和关系使用 `PENDING / ACCEPTED / IGNORED` 状态，与 `knowledge_nodes / knowledge_edges` 物理分离。重名、悬空关系、环和规模上限在候选阶段给出阻断信息，最终确认时会在 `BEGIN IMMEDIATE` 事务内重新检查，再同时写入正式节点/边并回填接纳 ID。所以未经用户明确确认的内容始终不会改变知识图谱。

M7B 的 DeepSeek 只能产出经共享 schema 验证的候选项，不能越过这条审核边界或直接写正式图谱。通过验证的结果由 repository 以 `AI` 来源和实际模型标记写入用户指定图谱的待审核区；多批生成必须全部完成并通过引用核对后才执行一次写入，任一批失败时不留下部分结果。

## 云端候选生成边界（ADR-011）

API Key 只在 renderer 的密码输入框中短暂存在，随后通过明确命名、经 Zod 验证的 IPC 交给 main；main 使用 Electron `safeStorage` 加密后保存，并且任何读取接口都不会返回密钥或密文。provider 地址固定为 DeepSeek 官方 API，密钥不进入 SQLite、日志、审计记录或 Git。若当前 Windows 环境不能提供安全存储，界面会拒绝保存，而不是降级为明文。

DeepSeek HTTP 请求由 main 注入 Electron `net.fetch`，使用 Chromium 网络栈继承 Windows 的系统代理和证书信任；不得用 `NODE_TLS_REJECT_UNAUTHORIZED=0` 绕过 TLS 校验。单元测试仍通过注入的 `fetch` 替身验证协议与失败分支。

用户点击生成后，先选择明确的目标图谱和连续章节范围；`AiService` 从 SQLite 重新读取所选章节并创建 10 分钟有效的预览 token。renderer 展示目标图谱、资料、章节、字符数、预计批次数和摘要，只有用户明确勾选同意后才可继续。确认时 main 再次读取相同章节，将正文按每批最多 32,000 字符拆分后顺序发送，不发送本机路径、其他章节、学习状态或 Evidence。

发送前，main 把本批授权原文确定性切成带临时 `sourceId` 的连续证据片段。DeepSeek 只能为概念选择本批已有的 `sourceId`，不负责抄写引用；main 再用该编号从 SQLite 原文重建不可变引用快照与 Unicode 码点区间。这样模型无法通过改字、漏字或拼接句子制造“看起来像原文”的引用。无效编号会触发一次整批安全重试，第二次仍无效则拒绝整批，且不会留下部分候选。

每批响应还必须通过运行时 JSON schema、概念/关系唯一性、先修引用和无环检查。全部批次成功后按规范化名称合并同名概念，并丢弃合并后产生的重复、自循环或冲突关系；最后通过一次 repository 调用原子写入候选区。请求支持主动取消和每批 90 秒超时，HTTP/网络错误转换为可执行的中文提示。`ai_generation_runs` 仅审计 provider、模型、完整章节范围、总字符数、汇总 token 数、结果数量、状态和错误，不保存正文、提示词、原始响应或密钥；失败重试所消耗的 token 也计入该次审计。

## Windows 分发（ADR-004）

M1 使用 Forge 的 ZIP maker，并实际验证可生成和运行 Windows x64 包。曾验证 Squirrel maker，但其旧 NuGet 工具在 Electron 44 的 `dxcompiler.dll` 上失败；为了不保留一个已知会失败的发布命令，当前配置不包含 Squirrel。安装器选择、Squirrel 启动事件、图标、代码签名和 SmartScreen 信誉作为 M10 的完整发布工作一起处理。

## 代码结构

```text
src/main/database        migration 与连接
src/main/repositories    SQL 和行映射
src/main/services        应用服务与输入验证
src/main/ipc             明确 IPC 注册
src/preload              contextBridge
src/renderer             React UI
src/shared               跨进程 schema、类型和 channel 常量
tests                    契约、持久化和 renderer smoke tests
```
