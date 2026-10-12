# 多层合并转发存图执行计划

实施状态：已完成开发与离线验证；任务清单见 [TODO.md](./TODO.md)。

## 目标

回复、直接传入或按提示发送包含多层合并聊天记录的消息时，逐层读取可访问的图片和视频，沿用现有分类、权限、命名和保存流程。某个内层读取失败时继续处理其他内容，并向用户说明未完全读取。

## 修改前的问题（源码核实）

- `src/index.ts` 已有递归，但仅处理 `message` / `forward`，不能完整遍历其他已展开容器。
- 原始 OneBot 消息段转换为 `h(seg.type, seg.data || seg.attrs)` 时丢失 `children` 和内嵌消息内容。
- CQ 字符串直接交给 `h.parse`，无法识别其中的 CQ 图片和嵌套转发引用。
- 转发资源 ID 优先传给普通 `getMessage`，非空但仍未展开的响应会阻止专用转发读取。
- 读取失败只出现在调试日志，用户无法区分没有图片与记录读取不完整。

## 实施步骤

- [x] 1. 新建媒体提取模块，统一处理 Koishi 元素、OneBot 消息段、CQ 字符串、消息列表及常见返回包装，保留子节点；同时识别 QQ 合并记录 JSON 卡片的资源 ID。
- [x] 2. 按消息顺序深度优先遍历；合并资源优先使用 `getForwardMsg` / `get_forward_msg`，没有专用接口时尝试标准读取，避免同一记录的展开内容与接口内容重复保存。
- [x] 3. 为单次收集缓存记录请求，记录已展开的最浅深度，按媒体位置去重并检测当前路径的循环引用；普通重复图片保持现有语义。设置可配置的合并层数、节点数和单次请求超时，并隔离局部错误。
- [x] 4. 接入引用、指令参数和交互输入，优先采用完整消息元素，补取只有摘要的引用消息；区分没有媒体与读取不完整，部分成功继续保存。
- [x] 5. 同步 README、入口 usage、命令帮助、Schema 和中英文桌面描述，写明多层能力及适配器边界。
- [x] 6. 使用离线夹具验证普通媒体、单层及三层以上嵌套、混合顺序、已展开容器、CQ 字符串、重复与循环引用、失败与超时以及限制；执行工作区根目录的目标插件构建，检查最终 diff。

## 验收边界

- 可读取节点中的媒体按原顺序进入现有保存流程；重复引用不重复请求/保存同一记录，独立重复图片仍保留。
- 失败、循环或达到处理上限有中文提示，不中断其他可处理分支。
- 不增加依赖，不修改锁文件，不修改部署配置，不提交、不发布。
- 不启动开发服务器；实际 QQ/Koishi 收发由用户手测，自动验证使用模拟适配器和文件保存入口。

## 执行记录

- 2026-09-07：核实插件独立 Git 仓库，初始工作区干净；写入本计划，开始实现。

- 2026-09-07：完成 src/media.ts 及三个存图入口集成；补齐仅摘要引用、不带关键词、QQ 合并记录 JSON 卡片、更浅位置重复引用等分支。
- 默认限制：32 层合并记录、10000 个节点、每次接口请求等待 15 秒；均可在 Schema 中配置。
- 构建通过：工作区根目录运行 `npm run build -- image-selector`，产出 lib/index.js 和类型声明。
- 回归通过：工作区根目录运行 `node --test --test-reporter=dot external/image-selector/tests/media.test.cjs external/image-selector/tests/save.test.cjs`，32 个用例全部通过。
- 其中 25 个用例验证解析，7 个用例调用实际构建产物的存图 action，使用模拟适配器/HTTP 和临时目录核对文件内容、命名、顺序、失败提示及权限。
- 最终差异检查通过；源码、文档与测试均限制在本插件仓库，未新增依赖、修改锁文件、提交或发布。真实 QQ/Koishi 手测保留在 TODO 中，未声称已执行。

## 已核实的协议依据

- [OneBot v11 API](https://github.com/botuniverse/onebot-11/blob/master/api/public.md)：普通消息 ID 与合并资源 ID 使用不同接口。
- [Koishi OneBot 消息转换](https://github.com/koishijs/koishi-plugin-adapter-onebot/blob/master/src/utils.ts)：消息转换保留未专门转换的转发/卡片类型。
- [LLOneBot 合并记录 JSON 卡片问题记录](https://github.com/LLOneBot/LuckyLilliaBot/issues/604)：已知 com.tencent.multimsg 的 meta.detail.resid 形态，已加入兼容；不解析其他卡片的预览媒体。
