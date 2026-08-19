import { Context, Schema, h, Session } from 'koishi'

import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export const name = 'image-selector'
export const inject = {
    required: ['http', 'logger']
};

export const usage = `
一个图片库管理插件。将图片按文件夹分类存放，发送关键词即可随机发图。

### 常用指令
- **关键词 [数量]**：直接发送关键词发图
- **存图 [关键词]**：保存图片或视频到指定分类
- **图库列表**：查看所有可用关键词及别名
- **刷新图库**：新增文件夹后手动刷新缓存

<a target="_blank" href="https://www.npmjs.com/package/@deepseaxx/koishi-plugin-image-selector">➤ 详细配置及进阶用法文档</a>
`;

export interface Config {
    tempPath: string
    imagePath: string
    promptTimeout: number
    filenameTemplate: string
    saveCommandName: string
    sendCommandName: string
    saveFailFallback: boolean
    listCommandName: string
    refreshCommandName: string
    createCommandName: string
    addAliasCommandName: string
    matchMode: 'fuzzy' | 'exact' | 'none'

    userLimits: { userId: string; sizeLimit: number }[]
    groupLimits: { guildId: string; sizeLimit: number }[]
    createLimits: { userId: string }[]
    maxout: number
    debugMode: boolean
}

export const Config: Schema<Config> =
    Schema.intersect([
        Schema.object({
            listCommandName: Schema.string().default('图库列表').description('图库列表指令名（可自定义）'),
            refreshCommandName: Schema.string().default('刷新图库').description('刷新图库缓存指令名（可自定义）'),
            createCommandName: Schema.string().default('创建关键词').description('创建文件夹指令名（可自定义）'),
            addAliasCommandName: Schema.string().default('创建别名').description('创建别名指令名（可自定义）'),
        }).description('图库指令'),
        Schema.object({
            sendCommandName: Schema.string().default('发图').description('发图指令名（可自定义）'),
            maxout: Schema.number().default(5).description('单次最大发图数量'),
            matchMode: Schema.union([
                Schema.const('fuzzy' as const).description('模糊匹配：消息以关键词开头即触发'),
                Schema.const('exact' as const).description('精确匹配：仅「关键词」或「关键词 数字」触发'),
                Schema.const('none' as const).description('禁用中间件：关键词不直接触发，仅限指令触发'),
            ]).default('fuzzy').description('关键词匹配模式'),
            imagePath: Schema.string().required().description('图片库根目录路径').role('textarea', { rows: [2, 4] }),
        }).description('发图功能'),
        Schema.object({
            saveCommandName: Schema.string().default('存图').description('存图指令名（可自定义）'),
            tempPath: Schema.string().required().description('临时存储目录路径').role('textarea', { rows: [2, 4] }),
            filenameTemplate: Schema.string().role('textarea', { rows: [2, 4] })
                .default("${date}-${time}-${index}-${guildId}-${userId}${ext}").description('存图文件名模板，可用变量：${userId} ${username} ${timestamp} ${date} ${time} ${index} ${ext} ${guildId} ${channelId}'),
            promptTimeout: Schema.number().default(30).description('交互式存图的等待超时（秒）'),
            saveFailFallback: Schema.boolean().default(true).description('关键词匹配失败时：开启则存入临时目录，关闭则直接取消'),
        }).description('存图功能'),
        Schema.object({
            userLimits: Schema.array(Schema.object({
                userId: Schema.string().required().description('用户 ID（填 default 作为全局默认）'),
                sizeLimit: Schema.number().min(0).step(0.1).required().description('上传上限（MB），0 表示禁止上传'),
            })).role('table')
                .description('用户上传限制。必须包含 userId 为 default 的行作为全局默认值，0 表示禁止上传。')
                .default([{ userId: 'default', sizeLimit: 0 }]),
            groupLimits: Schema.array(Schema.object({
                guildId: Schema.string().required().description('群组 ID（填 default 作为群组默认）'),
                sizeLimit: Schema.number().min(0).step(0.1).required().description('上传上限（MB），0 表示禁止上传'),
            })).role('table')
                .description('群组上传限制。可包含 guildId 为 default 的行作为群组默认值，0 表示禁止上传。')
                .default([{ guildId: 'default', sizeLimit: 0 }]),
            createLimits: Schema.array(Schema.object({
                userId: Schema.string().required().description('用户 ID'),
            })).role('table')
                .description('允许创建文件夹和别名的用户列表。')
                .default([]),
        }).description('权限设置'),
        Schema.object({
            debugMode: Schema.boolean().default(false).description('启用调试日志').experimental(),
        }).description('调试模式'),

    ]);


export function apply(ctx: Context, config: Config) {
    config = config || {} as Config

    function loginfo(...args: any[]) {
        if (config.debugMode) {
            (ctx.logger.info as (...args: any[]) => void)(...args);
        }
    }

    // 文件夹缓存机制
    let folderCache: { folders: any[], timestamp: number } | null = null
    const CACHE_TTL = 5 * 60 * 1000 // 5分钟缓存

    async function getFolders() {
        const now = Date.now()
        if (!folderCache || (now - folderCache.timestamp > CACHE_TTL)) {
            loginfo('缓存已过期或不存在，重新读取文件夹列表')
            const folders = await fs.readdir(config.imagePath, { withFileTypes: true })
            folderCache = { folders, timestamp: now }
            loginfo(`已缓存 ${folders.length} 个文件夹`)
        } else {
            loginfo('使用缓存的文件夹列表')
        }
        return folderCache.folders
    }

    function clearCache() {
        folderCache = null
        loginfo('文件夹缓存已清除')
    }

    const getFileExtension = (file: any, imgType: string) => {
        loginfo('文件信息:', JSON.stringify(file, null, 2))

        let detectedExtension = ''

        // 优先根据 file.type 和 file.mime 确定后缀名
        const mimeType = file.type || file.mime

        if (mimeType === 'image/jpeg') {
            detectedExtension = '.jpg'
        } else if (mimeType === 'image/png') {
            detectedExtension = '.png'
        } else if (mimeType === 'image/gif') {
            detectedExtension = '.gif'
        } else if (mimeType === 'image/webp') {
            detectedExtension = '.webp'
        } else if (mimeType === 'image/bmp') {
            detectedExtension = '.bmp'
        } else if (mimeType === 'video/mp4') {
            detectedExtension = '.mp4'
        } else if (mimeType === 'video/quicktime') {
            detectedExtension = '.mov'
        } else if (mimeType === 'video/x-msvideo') {
            detectedExtension = '.avi'
        } else if (mimeType) {
            // 如果有 type 或 mime，但不是常见的类型，则记录警告
            loginfo(`未知的文件类型，file.type=${file.type}, file.mime=${file.mime}`)
            detectedExtension = imgType === 'video' ? '.mp4' : '.jpg'
        } else {
            // 如果没有任何类型信息，则使用默认值
            loginfo(`无法检测到文件类型，file.type=${file.type}, file.mime=${file.mime}`)
            detectedExtension = imgType === 'video' ? '.mp4' : '.jpg'
        }

        loginfo('检测到的文件扩展名:', detectedExtension)
        return detectedExtension
    }

    // 查找角色名称匹配的文件夹
    async function findCharacterFolder(characterName: string): Promise<string | null> {
        try {
            // 首先检查临时存储路径是否已有对应文件夹
            const tempFolders = await fs.readdir(config.tempPath, { withFileTypes: true })
            for (const folder of tempFolders) {
                if (!folder.isDirectory()) continue
                const folderName = folder.name
                const aliases = folderName.split('-')
                if (aliases.includes(characterName)) {
                    loginfo('在临时路径找到匹配的文件夹:', folderName)
                    return folderName
                }
            }

            // 如果临时路径没有，则从图片库路径查找
            const imageFolders = await fs.readdir(config.imagePath, { withFileTypes: true })
            for (const folder of imageFolders) {
                if (!folder.isDirectory()) continue
                const folderName = folder.name
                const aliases = folderName.split('-')
                if (aliases.includes(characterName)) {
                    loginfo('在图片库找到匹配的文件夹:', folderName)
                    return folderName
                }
            }

            return null
        } catch (error) {
            loginfo('查找角色文件夹失败:', error)
            return null
        }
    }

    // 递归提取元素中的图片与视频节点（支持普通消息与 OneBot 协议合并转发消息）
    async function extractMediaElements(elements: h[], session: Session, visitedIds = new Set<string>()): Promise<h[]> {
        const mediaList: h[] = []

        for (const el of elements) {
            if (!el) continue

            // 1. 直接是图片/视频元素
            if (['img', 'mface', 'image', 'video'].includes(el.type)) {
                mediaList.push(el)
            }
            // 2. 普通 message 容器节点，递归其 children
            else if (el.type === 'message') {
                if (el.children && el.children.length > 0) {
                    const subMedia = await extractMediaElements(el.children, session, visitedIds)
                    mediaList.push(...subMedia)
                }
            }
            // 3. forward 合并转发节点（包含 OneBot 协议下的转发记录）
            else if (el.type === 'forward') {
                // 如果节点下自带子节点（如已经展开的 message 节点）
                if (el.children && el.children.length > 0) {
                    const subMedia = await extractMediaElements(el.children, session, visitedIds)
                    mediaList.push(...subMedia)
                }

                // 如果带有 forward id 且尚未遍历过
                const forwardId = el.attrs?.id || el.attrs?.messageId
                if (forwardId && !visitedIds.has(forwardId)) {
                    visitedIds.add(forwardId)
                    loginfo(`发现合并转发节点 ID: ${forwardId}，尝试拉取子消息 (OneBot 适配)`)

                    try {
                        let fetchedElements: h[] = []

                        // 优先尝试标准 session.bot.getMessage
                        if (session.bot && typeof session.bot.getMessage === 'function') {
                            try {
                                const msg = await session.bot.getMessage(session.channelId, forwardId)
                                if (msg && msg.elements && msg.elements.length > 0) {
                                    fetchedElements = msg.elements
                                } else if (msg && msg.content) {
                                    fetchedElements = h.parse(msg.content)
                                }
                            } catch (err) {
                                loginfo(`session.bot.getMessage 获取转发消息 ${forwardId} 失败: ${err.message}`)
                            }
                        }

                        // 针对 OneBot v11 特有 API 进行兜底 (internal.get_forward_msg 或 internal.getForwardMsg)
                        if (fetchedElements.length === 0 && session.bot && session.bot.internal) {
                            const internal = session.bot.internal
                            let forwardData: any = null

                            try {
                                if (typeof internal.getForwardMsg === 'function') {
                                    forwardData = await internal.getForwardMsg(forwardId)
                                } else if (typeof internal.get_forward_msg === 'function') {
                                    forwardData = await internal.get_forward_msg({ id: forwardId, message_id: forwardId })
                                }
                            } catch (err) {
                                loginfo(`OneBot internal.get_forward_msg 扩展接口调用失败: ${err.message}`)
                            }

                            if (forwardData) {
                                const rawMessages = forwardData.messages || (Array.isArray(forwardData) ? forwardData : [])
                                for (const rawMsg of rawMessages) {
                                    const content = rawMsg.content || rawMsg.message
                                    if (typeof content === 'string') {
                                        fetchedElements.push(...h.parse(content))
                                    } else if (Array.isArray(content)) {
                                        // CQCode/Segment 数组
                                        for (const seg of content) {
                                            if (typeof seg === 'string') {
                                                fetchedElements.push(...h.parse(seg))
                                            } else if (seg && seg.type) {
                                                fetchedElements.push(h(seg.type, seg.data || seg.attrs || {}))
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        if (fetchedElements.length > 0) {
                            const subMedia = await extractMediaElements(fetchedElements, session, visitedIds)
                            mediaList.push(...subMedia)
                        }
                    } catch (e) {
                        loginfo(`解析合并转发节点 ${forwardId} 出错:`, e)
                    }
                }
            }
        }

        return mediaList
    }

    // 存图指令
    ctx.command(`${config.saveCommandName} [关键词] [...图片]`, { captureQuote: false })
        .usage(`用法：${config.saveCommandName} [关键词] [图片]
直接带图：${config.saveCommandName} 猫图 [图片]
引用存图：回复图片消息或合并转发聊天记录后发送 ${config.saveCommandName} [关键词]（注：合并转发存图功能主要针对 OneBot 协议支持）
交互式：直接发送 ${config.saveCommandName}，按提示操作

关键词为文件夹名或别名（格式：主名-别名1-别名2），匹配失败时根据配置存入临时目录或取消。`)
        .userFields(['id', 'name', 'authority'])
        .action(async ({ session }, keyword, ...图片) => {
            // 预处理：检查第一参数是否为图片
            if (keyword) {
                const elements = h.parse(keyword)
                if (elements.some(el => ['img', 'mface', 'image', 'video'].includes(el.type))) {
                    图片.unshift(keyword)
                    keyword = undefined
                }
            }

            let allImages: h[] = []

            // 优先检查引用消息中的图片/媒体（支持普通图片回复和 OneBot 合并转发回复）
            if (session.quote) {
                loginfo('检测到引用消息，尝试从引用消息中提取图片/视频 (支持合并转发)')
                const quoteElements = h.parse(session.quote.content)
                const extractedFromQuote = await extractMediaElements(quoteElements, session)

                // 如果从 quote.content 没有解析出媒体，但包含 quote.id，尝试拉取完整的引用消息对象
                if (extractedFromQuote.length === 0 && session.quote.id) {
                    try {
                        const fullQuote = await session.bot?.getMessage?.(session.channelId, session.quote.id)
                        if (fullQuote) {
                            const fullElements = fullQuote.elements || (fullQuote.content ? h.parse(fullQuote.content) : [])
                            const extra = await extractMediaElements(fullElements, session)
                            extractedFromQuote.push(...extra)
                        }
                    } catch (err) {
                        loginfo('拉取完整引用消息失败:', err)
                    }
                }

                if (extractedFromQuote.length > 0) {
                    loginfo(`从引用消息/合并转发记录中成功提取到 ${extractedFromQuote.length} 个媒体文件`)
                    allImages.push(...extractedFromQuote)
                }
            }

            // 如果引用中没有图片，解析直接传入的参数中的图片
            if (allImages.length === 0) {
                for (const 图片Item of 图片) {
                    const elements = h.parse(图片Item)
                    const media = await extractMediaElements(elements, session)
                    allImages.push(...media)
                }
            }

            // 如果没有图片(参数或引用)，尝试交互式获取
            if (allImages.length === 0) {
                await session.send('请发送图片、视频或合并转发聊天记录')
                const promptResult = await session.prompt(config.promptTimeout * 1000)
                if (!promptResult) {
                    return '未收到图片或视频'
                }
                const elements = h.parse(promptResult)
                const media = await extractMediaElements(elements, session)
                allImages.push(...media)
            }

            if (allImages.length === 0) {
                return '未收到有效的图片或视频'
            }

            // 检查是否已有分类（关键词），如果没有则询问
            if (!keyword) {
                await session.send('请回复要保存的分类名称或关键词（等待30秒超时）')
                const reply = await session.prompt(30 * 1000)
                if (!reply) {
                    return '等待超时，未执行保存'
                }
                keyword = reply.trim()
            }

            // 检查权限和尺寸限制
            const userId = session.userId
            const guildId = session.guildId
            const userLimits = config.userLimits || []
            const groupLimits = config.groupLimits || []

            // 将数组转换为字典以便快速查找
            const userLimitsDict: Record<string, number> = {}
            if (Array.isArray(userLimits)) {
                for (const item of userLimits) {
                    if (item && item.userId !== undefined && item.sizeLimit !== undefined) {
                        userLimitsDict[item.userId] = item.sizeLimit
                    }
                }
            }

            const groupLimitsDict: Record<string, number> = {}
            if (Array.isArray(groupLimits)) {
                for (const item of groupLimits) {
                    if (item && item.guildId !== undefined && item.sizeLimit !== undefined) {
                        groupLimitsDict[item.guildId] = item.sizeLimit
                    }
                }
            }

            // 查找顺序: 用户独立设置 -> 群组独立设置 -> 群组默认设置 -> 全局默认设置(用户default) -> 0
            let limit: number | undefined

            // 1. 具体用户
            if (userLimitsDict[userId] !== undefined) {
                limit = userLimitsDict[userId]
            }

            // 2. 具体群组
            if (limit === undefined && guildId && groupLimitsDict[guildId] !== undefined) {
                limit = groupLimitsDict[guildId]
            }

            // 3. 群组默认
            if (limit === undefined && guildId && groupLimitsDict['default'] !== undefined) {
                limit = groupLimitsDict['default']
            }

            // 4. 全局默认 (fallback to user default)
            if (limit === undefined) {
                limit = userLimitsDict['default']
            }

            // 5. 最终兜底
            if (limit === undefined || limit === null) {
                limit = 0
            }

            // 非法值（负数等）视为 0
            if (typeof limit !== 'number' || limit < 0 || isNaN(limit)) {
                limit = 0
            }

            const sizeLimitMB = limit

            if (sizeLimitMB <= 0) {
                return '当前用户无上传权限或已被禁止上传'
            }

            loginfo(`用户 ${userId} 上传限制: ${sizeLimitMB}MB`)

            const sizeLimitBytes = sizeLimitMB * 1024 * 1024

            try {
                let targetPath = config.tempPath
                let folderName = ''
                let matched = false

                // 尝试在图片库中匹配文件夹 (使用发图相同的逻辑)
                if (keyword) {
                    const imageFolders = await getFolders()
                    const matchedFolders = []
                    for (const folder of imageFolders) {
                        if (!folder.isDirectory()) continue
                        const folderName = folder.name
                        const aliases = folderName.split('-')
                        if (aliases.includes(keyword)) {
                            matchedFolders.push(folderName)
                        }
                    }

                    if (matchedFolders.length > 0) {
                        folderName = matchedFolders[0]
                        targetPath = join(config.imagePath, folderName)
                        matched = true
                        loginfo('在图片库匹配到文件夹:', folderName)
                    } else {
                        if (!config.saveFailFallback) {
                            return `关键词 "${keyword}" 匹配失败，已取消保存`
                        }
                        loginfo(`关键词 "${keyword}" 未在图片库找到匹配文件夹，将保存到临时目录`)
                    }
                }

                // 确保目标路径存在
                await fs.mkdir(targetPath, { recursive: true })

                const baseTimestamp = Date.now()
                let savedCount = 0

                for (let i = 0; i < allImages.length; i++) {
                    const img = allImages[i]
                    const url = img.attrs.src || img.attrs.url
                    if (!url) continue

                    const file = await ctx.http.file(url)
                    if (!file || !file.data) {
                        loginfo('无法获取文件数据:', url)
                        continue
                    }

                    const buffer = Buffer.from(file.data)

                    if (buffer.length > sizeLimitBytes) {
                        const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2)
                        loginfo(`文件大小超出限制: ${sizeMB}MB > ${sizeLimitMB}MB`)
                        await session.send(`文件 ${i + 1} 大小(${sizeMB}MB)超出限制(${sizeLimitMB}MB)，已跳过`)
                        continue
                    }

                    const ext = getFileExtension(file, img.type)

                    // 使用基础时间戳 + 微秒偏移确保唯一性
                    const timestamp = baseTimestamp + i
                    const now = new Date(timestamp)
                    const date = now.toISOString().split('T')[0]
                    const time = now.toTimeString().split(' ')[0].replace(/:/g, '-')

                    let filename = config.filenameTemplate
                        .replace(/\$\{userId\}/g, session.userId || 'unknown')
                        .replace(/\$\{username\}/g, session.username || 'unknown')
                        .replace(/\$\{timestamp\}/g, timestamp.toString())
                        .replace(/\$\{date\}/g, date)
                        .replace(/\$\{time\}/g, time)
                        .replace(/\$\{index\}/g, (i + 1).toString())
                        .replace(/\$\{ext\}/g, ext)
                        .replace(/\$\{guildId\}/g, session.guildId || 'private')
                        .replace(/\$\{channelId\}/g, session.channelId || 'unknown')

                    filename = filename.replace(/[\u0000-\u001f\u007f-\u009f\/\\:*?"<>|]/g, '_')

                    const filepath = join(targetPath, filename)

                    await fs.writeFile(filepath, buffer)
                    savedCount++

                    loginfo(`保存文件 ${i + 1}/${allImages.length}:`, filename)
                }

                if (matched) {
                    return `已保存 ${savedCount} 个文件到"${folderName}"文件夹`
                } else {
                    return `找不到"${keyword}"文件夹，已保存 ${savedCount} 个文件到临时文件夹`
                }
            } catch (error) {
                return `保存失败: ${error.message}`
            }

        })

    // 图库列表指令
    ctx.command(`${config.listCommandName}`)
        .usage(`用法：${config.listCommandName}
列出所有图库分类及别名，直接发送关键词或别名即可随机获取图片。`)
        .action(async ({ session }) => {
            try {
                const folders = await getFolders()
                let messageLines = []

                // 收集并格式化文件夹信息
                let hasFolders = false

                for (const folder of folders) {
                    if (!folder.isDirectory()) continue

                    hasFolders = true
                    const folderName = folder.name
                    const parts = folderName.split('-')
                    const mainName = parts[0]
                    const aliases = parts.slice(1)

                    if (aliases.length > 0) {
                        messageLines.push(`${mainName} 别名：${aliases.join(', ')}`)
                    } else {
                        messageLines.push(`${mainName}`)
                    }
                }

                if (!hasFolders) {
                    return '图库为空'
                }

                const header = `发送指令或别名随机返回图片，也可使用“${config.sendCommandName} 关键词 数量”`
                return [header, ...messageLines].join('\n')

            } catch (error) {
                return `获取列表失败: ${error.message}`
            }
        })

    // 刷新图库缓存指令
    ctx.command(`${config.refreshCommandName}`)
        .usage(`用法：${config.refreshCommandName}
手动刷新文件夹缓存。添加、删除或重命名分类文件夹后执行，立即生效无需重启。`)
        .action(async ({ session }) => {
            try {
                clearCache()
                const folders = await getFolders()
                const folderCount = folders.filter(f => f.isDirectory()).length
                return `图库缓存已刷新，当前共有 ${folderCount} 个文件夹`
            } catch (error) {
                return `刷新失败: ${error.message}`
            }
        })

    // 创建关键词指令
    ctx.command(`${config.createCommandName} <keyword> [aliases...]`)
        .action(async ({ session }, keyword: string, ...aliases: string[]) => {
            if (!keyword) {
                return '请完整输入指令+文件夹名，例如：“创建关键词 文件夹名 别名1”'
            }

            const createLimits = config.createLimits || []
            const allowedUsers = createLimits.map(item => item.userId)
            if (!allowedUsers.includes(session.userId)) {
                return
            }

            const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_')
            const mainPart = sanitize(keyword)
            const aliasParts = aliases.map(a => sanitize(a)).filter(a => a.length > 0)

            if (mainPart.length === 0) {
                return '关键词无效（过滤后为空）。'
            }

            const folders = await getFolders()
            const allAliases = [mainPart, ...aliasParts]

            let exists = false
            for (const folder of folders) {
                if (!folder.isDirectory()) continue
                const parts = folder.name.split('-')
                if (parts.some(p => allAliases.includes(p))) {
                    exists = true
                    break
                }
            }

            if (exists) {
                return '要创建的关键词或别名在实际文件夹系统中已存在！无法创建。'
            }

            const newFolderName = allAliases.join('-')
            const newFolderPath = join(config.imagePath, newFolderName)

            try {
                await fs.mkdir(newFolderPath, { recursive: true })
                clearCache()
                const aliasesText = aliasParts.length > 0 ? `，别名：${aliasParts.join('、')}` : ''
                return `关键词「${mainPart}」创建成功${aliasesText}！`
            } catch (error) {
                loginfo('创建分类失败:', error)
                return `创建失败: ${error.message}`
            }
        })

    // 创建别名指令
    ctx.command(`${config.addAliasCommandName} <keyword> [aliases...]`)
        .action(async ({ session }, keyword: string, ...aliases: string[]) => {
            if (!keyword || aliases.length === 0) {
                return '请完整输入正确指令，例如：“创建别名 关键词 别名1 别名2”'
            }

            const createLimits = config.createLimits || []
            const allowedUsers = createLimits.map(item => item.userId)
            if (!allowedUsers.includes(session.userId)) {
                return
            }

            const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_')
            const mainPart = sanitize(keyword)
            const aliasParts = aliases.map(a => sanitize(a)).filter(a => a.length > 0)

            if (aliasParts.length === 0) {
                return '别名无效（过滤后为空）。'
            }

            const folders = await getFolders()
            let targetFolder = null
            let targetOldName = ''
            let targetParts: string[] = []

            for (const folder of folders) {
                if (!folder.isDirectory()) continue
                const parts = folder.name.split('-')
                if (parts.includes(mainPart)) {
                    targetFolder = folder
                    targetOldName = folder.name
                    targetParts = parts
                    break
                }
            }

            if (!targetFolder) {
                return '未找到指定关键词文件夹，请完整输入正确指令'
            }

            let existsAnywhere = false
            for (const folder of folders) {
                if (!folder.isDirectory()) continue
                const parts = folder.name.split('-')
                if (aliasParts.some(a => parts.includes(a))) {
                    existsAnywhere = true
                    break
                }
            }

            if (existsAnywhere) {
                return '要添加的别名已经存在于现有关键词或别名中，无法添加。'
            }

            const newAliases = aliasParts.filter(a => !targetParts.includes(a))
            if (newAliases.length === 0) {
                return '所有别名都已经存在于该关键词中。'
            }

            const newFolderName = [...targetParts, ...newAliases].join('-')
            const oldPath = join(config.imagePath, targetOldName)
            const newPath = join(config.imagePath, newFolderName)

            try {
                await fs.rename(oldPath, newPath)
                clearCache()
                return `别名添加成功！该关键词现在包含：${[...targetParts, ...newAliases].join('、')}。`
            } catch (error) {
                loginfo('创建别名失败:', error)
                return `添加别名失败: ${error.message}`
            }
        })

    async function processImageRequest(session: Session, input: string) {
        if (!input) return false

        try {
            const folders = await getFolders()
            const useExactMatch = config.matchMode === 'exact'

            // 寻找所有可能的匹配
            const possibleMatches = []

            for (const folder of folders) {
                if (!folder.isDirectory()) continue

                const folderName = folder.name
                const aliases = folderName.split('-')

                for (const alias of aliases) {
                    if (useExactMatch) {
                        // 精确匹配：仅允许「关键词」或「关键词 数字」
                        if (input === alias) {
                            possibleMatches.push({ folderName, alias, suffix: '', aliasLength: alias.length })
                        } else if (input.startsWith(alias + ' ')) {
                            const suffix = input.slice(alias.length + 1).trim()
                            if (/^\d*$/.test(suffix)) {
                                possibleMatches.push({ folderName, alias, suffix, aliasLength: alias.length })
                            }
                        }
                    } else {
                        // 模糊匹配（默认）：input 以 alias 开头即触发
                        if (input.startsWith(alias)) {
                            const suffix = input.slice(alias.length).trim()
                            possibleMatches.push({ folderName, alias, suffix, aliasLength: alias.length })
                        }
                    }
                }
            }

            if (possibleMatches.length === 0) {
                return false
            }

            // 按别名长度降序排序，取最长匹配
            possibleMatches.sort((a, b) => b.aliasLength - a.aliasLength)
            const bestMatch = possibleMatches[0]

            // 收集所有具有相同最长别名的匹配（可能有多个文件夹使用相同别名）
            const bestMatches = possibleMatches.filter(m => m.aliasLength === bestMatch.aliasLength && m.alias === bestMatch.alias)

            // 随机选择一个文件夹
            const selectedMatch = bestMatches[Math.floor(Math.random() * bestMatches.length)]

            const { folderName, suffix } = selectedMatch

            loginfo('匹配结果:', { folderName, alias: selectedMatch.alias, suffix })
            if (bestMatches.length > 1) {
                ctx.logger.warn(`检测到别名重名: "${selectedMatch.alias}" 匹配到 ${bestMatches.length} 个文件夹: ${bestMatches.map(m => m.folderName).join(', ')}`)
            }

            // 解析数量
            let count = 1
            if (suffix) {
                // 如果 input = "alias" + "suffix"
                // 比如 "猫图 5" -> suffix="5".
                // "猫图5" -> suffix="5".
                // "猫图 abc" -> suffix="abc".
                if (/^\d+$/.test(suffix)) {
                    count = Math.min(parseInt(suffix, 10), config.maxout)
                } else {
                    // suffix 不是纯数字，视为无效数量，保持 count=1
                    count = 1
                }
            }

            // 只有在确定是纯数字时才应用 limit
            if (count > config.maxout) {
                count = config.maxout
            }

            loginfo(`请求图片数量: ${count} (Max: ${config.maxout})`)

            const folderPath = join(config.imagePath, folderName)
            const files = await fs.readdir(folderPath)
            const mediaFiles = files.filter(file =>
                /\.(jpe?g|png|gif|webp|mp4|mov|avi|bmp|tiff?)$/i.test(file)
            )

            if (mediaFiles.length === 0) {
                // 匹配到了文件夹但为空，也算作处理了? 或者不算?
                // 按照旧逻辑，这里 return '该文件夹暂无图片或视频' (给中间件返回 string 意味着回复消息)
                // 中间件中 return string 是合法的。
                await session.send('该文件夹暂无图片或视频')
                return true
            }

            // 循环发送图片
            for (let i = 0; i < count; i++) {
                const randomFile = mediaFiles[Math.floor(Math.random() * mediaFiles.length)]
                const filePath = join(folderPath, randomFile)

                loginfo(`发送文件 ${i + 1}/${count}:`, randomFile)

                const isVideo = /\.(mp4|mov|avi)$/i.test(randomFile)
                const element = isVideo
                    ? h.video(filePath)
                    : h.image(filePath)

                await session.send(element)
            }

            return true

        } catch (error) {
            loginfo('发图失败:', error)
            return false
        }
    }

    // 发图指令
    ctx.command(`${config.sendCommandName} <keyword:text>`)
        .usage(`用法：${config.sendCommandName} <关键词> [数量]
匹配模式（可在配置修改）：
- 模糊：关键词开头即触发，后缀非数字时发 1 张
- 精确：仅「关键词」或「关键词 数字」触发，其余忽略
- 禁用：仅限指令触发，关键词不再作为消息直接触发

使用 ${config.listCommandName} 查看所有可用关键词。`)
        .action(async ({ session }, keyword) => {
            if (!keyword) {
                await session.execute(`${config.sendCommandName} -h`)
                return
            }
            // 复用逻辑
            const processed = await processImageRequest(session, keyword)
            if (!processed) {
                // 如果需要和“猫图”完全一致的逻辑：
                // "猫图" 不存在 -> 无反应
                // 这里的 processed 为 false 表示没找到匹配。
                // 所以无反应。
            }
        })

    // 发图中间件
    ctx.middleware(async (session, next) => {
        const input = session.stripped.content.trim()
        if (!input || config.matchMode === 'none') return next()

        // loginfo('收到消息:', { ... })

        await processImageRequest(session, input)
        return next()
    }, true)
}
