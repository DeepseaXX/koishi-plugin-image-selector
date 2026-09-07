import { Context, Schema, h, Session } from 'koishi'
import { createMediaCollector } from './media'

import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export const name = 'image-selector'
export const inject = {
    required: ['http', 'logger']
};

export const usage = `
把图片和视频按文件夹整理好，发送关键词即可随机发出对应内容；也可以回复图片、视频或多层嵌套的合并转发聊天记录进行存图。

### 快速开始
- 直接发送关键词，例如：猫图 或 猫图 3。
- 使用 存图 关键词 保存图片、视频或回复消息中的媒体。
- 使用 图库列表 查看当前分类和别名。
- 新增或重命名文件夹后，使用 刷新图库 立即更新。

文件夹名称使用 主关键词-别名1-别名2 的格式，每一段都可以触发发图。

合并记录会按消息顺序逐层提取图片和视频；部分记录读取失败时，继续保存其他可读取媒体并提示原因。默认最多展开 32 层、处理 10000 个节点，每次读取等待 15 秒，可在存图设置中调整。

普通图片和视频通常可以跨适配器处理。折叠的合并记录优先通过 OneBot 转发接口读取；其他适配器需提供已展开内容，或能通过标准消息接口读取相应记录。

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
    forwardMaxDepth: number
    forwardMaxNodes: number
    forwardTimeout: number
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
            listCommandName: Schema.string().default('图库列表').description('查看分类和别名的指令名称'),
            refreshCommandName: Schema.string().default('刷新图库').description('立即重新读取文件夹的指令名称'),
            createCommandName: Schema.string().default('创建关键词').description('创建分类文件夹的管理指令名称'),
            addAliasCommandName: Schema.string().default('创建别名').description('给已有分类添加别名的管理指令名称'),
        }).description('图库管理指令'),
        Schema.object({
            sendCommandName: Schema.string().default('发图').description('使用指令发图时的指令名称'),
            maxout: Schema.number().default(5).description('一次最多发送多少个图片或视频'),
            matchMode: Schema.union([
                Schema.const('fuzzy' as const).description('模糊：消息以关键词开头就触发，例如“猫图好可爱”也可能触发'),
                Schema.const('exact' as const).description('精确：只响应“关键词”或“关键词 数字”'),
                Schema.const('none' as const).description('关闭消息触发：只通过发图指令调用'),
            ]).default('fuzzy').description('直接发送关键词时，怎样判断是否应该发图'),
            imagePath: Schema.string().required().description('图片库根目录。里面的每个子文件夹都是一个分类，文件夹名也就是关键词或别名。').role('textarea', { rows: [2, 4] }),
        }).description('发图功能'),
        Schema.object({
            saveCommandName: Schema.string().default('存图').description('保存图片或视频时使用的指令名称'),
            tempPath: Schema.string().required().description('临时存储目录。找不到对应分类时，文件可能会保存到这里。').role('textarea', { rows: [2, 4] }),
            filenameTemplate: Schema.string().role('textarea', { rows: [2, 4] })
                .default("${date}-${time}-${index}-${guildId}-${userId}${ext}").description('保存后的文件名模板。可用变量：${userId}、${username}、${timestamp}、${date}、${time}、${index}、${ext}、${guildId}、${channelId}'),
            promptTimeout: Schema.number().default(30).description('机器人等待你发送图片或视频的时间，单位为秒'),
            saveFailFallback: Schema.boolean().default(true).description('找不到对应分类时，开启则保存到临时目录，关闭则取消保存'),
            forwardMaxDepth: Schema.number().min(1).max(256).step(1).default(32).description('最多展开多少层合并聊天记录。达到上限时保留已读取的媒体并提示。'),
            forwardMaxNodes: Schema.number().min(1).max(100000).step(1).default(10000).description('一次存图最多检查多少个消息、容器或媒体节点。达到上限时停止继续读取并提示。'),
            forwardTimeout: Schema.number().min(1).max(120).default(15).description('每次读取引用消息或合并记录的最长等待时间，单位为秒。超时后继续处理其他记录。'),
        }).description('存图功能'),
        Schema.object({
            userLimits: Schema.array(Schema.object({
                userId: Schema.string().required().description('用户 ID。填写 default 作为全局默认值。'),
                sizeLimit: Schema.number().min(0).step(0.1).required().description('单个文件的大小上限，单位 MB；填写 0 表示禁止存图。'),
            })).role('table')
                .description('用户上传大小限制。具体用户设置会优先于群组和全局设置；建议保留一行 userId 为 default 的默认值。')
                .default([{ userId: 'default', sizeLimit: 0 }]),
            groupLimits: Schema.array(Schema.object({
                guildId: Schema.string().required().description('群组 ID。填写 default 作为群组默认值。'),
                sizeLimit: Schema.number().min(0).step(0.1).required().description('群组成员单个文件的大小上限，单位 MB；填写 0 表示禁止存图。'),
            })).role('table')
                .description('群组上传大小限制。具体群组设置会优先于群组默认值和全局默认值。')
                .default([{ guildId: 'default', sizeLimit: 0 }]),
            createLimits: Schema.array(Schema.object({
                userId: Schema.string().required().description('允许使用创建分类和添加别名指令的用户 ID'),
            })).role('table')
                .description('只有列表中的用户可以创建分类文件夹或添加别名。')
                .default([]),
        }).description('权限设置'),
        Schema.object({
            debugMode: Schema.boolean().default(false).description('在控制台输出匹配、缓存和文件处理细节，排查问题时临时开启即可。').experimental(),
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

    // 存图指令
    ctx.command(`${config.saveCommandName} [关键词] [...图片]`, { captureQuote: false })
        .usage(`用法：${config.saveCommandName} [关键词] [图片]
1. 直接带图：${config.saveCommandName} 猫图 [图片]
2. 回复图片、视频或多层合并转发后发送：${config.saveCommandName} 猫图
3. 直接发送 ${config.saveCommandName}，按提示依次发送媒体和分类名称

关键词可以是文件夹名，也可以是别名。文件夹格式为：主名-别名1-别名2。
找不到对应分类时，会根据设置保存到临时目录或取消保存。

合并记录会逐层读取，部分失败时继续保存其他媒体并提示。默认最多 32 层、10000 个节点，每次读取等待 15 秒，可在存图设置中调整。
折叠记录优先使用 OneBot 转发接口；其他适配器需提供已展开内容或支持标准消息接口读取。`)
        .userFields(['id', 'name', 'authority'])
        .action(async ({ session }, keyword, ...图片) => {
            // 不带关键词直接附媒体/合并记录时，后续再询问分类。
            if (keyword) {
                const elements = h.parse(keyword)
                if (elements.some(el => ['img', 'mface', 'image', 'video', 'forward', 'message', 'node', 'figure', 'json', 'onebot:json'].includes(el.type))
                    || /\[CQ:(?:image|mface|video|forward|node|json),/.test(keyword)) {
                    图片.unshift(keyword)
                    keyword = undefined
                }
            }

            const collector = createMediaCollector(session, {
                maxDepth: config.forwardMaxDepth,
                maxNodes: config.forwardMaxNodes,
                timeoutMs: (config.forwardTimeout ?? 15) * 1000,
                log: loginfo,
                setTimeout: (callback, delay) => ctx.setTimeout(callback, delay),
            })
            let allImages: h[] = []

            // 优先检查引用消息中的图片/媒体（支持普通图片回复和 OneBot 合并转发回复）
            if (session.quote) {
                loginfo('检测到引用消息，尝试从引用消息中提取图片/视频 (支持合并转发)')
                const extractedFromQuote = await collector.collect(session.quote)

                // 如果从 quote.content 没有解析出媒体，但包含 quote.id，尝试拉取完整的引用消息对象
                if (extractedFromQuote.media.length === 0 && session.quote.id) {
                    const fullQuote = await collector.readQuote(session.quote.id)
                    if (fullQuote) {
                        const extra = await collector.collect(fullQuote)
                        extractedFromQuote.media.push(...extra.media)
                    }
                }

                if (extractedFromQuote.media.length > 0) {
                    loginfo(`从引用消息/合并转发记录中成功提取到 ${extractedFromQuote.media.length} 个媒体文件`)
                    allImages.push(...extractedFromQuote.media)
                }
            }

            // 如果引用中没有图片，解析直接传入的参数中的图片
            if (allImages.length === 0) {
                for (const 图片Item of 图片) {
                    const result = await collector.collect(图片Item)
                    allImages.push(...result.media)
                }
            }

            // 没有媒体且没有读取错误时，才提示用户继续上传。
            if (allImages.length === 0 && collector.warnings.length === 0) {
                await session.send('请发送要保存的图片、视频或合并转发聊天记录。')
                const promptResult = await session.prompt(config.promptTimeout * 1000)
                if (!promptResult) {
                    return '没有收到图片或视频，这次存图已取消。'
                }
                const result = await collector.collect(promptResult)
                allImages.push(...result.media)
            }

            if (allImages.length === 0) {
                return collector.warnings.length
                    ? `未能完整读取消息，本次没有找到可保存的图片或视频。原因：${collector.warnings.join('；')}。`
                    : '没有找到可保存的图片或视频。'
            }

            if (collector.warnings.length) {
                await session.send(`消息未完全读取：${collector.warnings.join('；')}。将继续尝试保存已找到的 ${allImages.length} 个媒体文件。`)
            }

            // 检查是否已有分类（关键词），如果没有则询问
            if (!keyword) {
                await session.send('请回复要保存到哪个分类（关键词或别名），等待 30 秒后自动取消。')
                const reply = await session.prompt(30 * 1000)
                if (!reply) {
                    return '等待超时，这次存图没有执行。'
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
                return '你目前没有存图权限，或上传大小上限设置为 0。'
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
                            return `找不到分类“${keyword}”，这次存图已取消。`
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
                        await session.send(`第 ${i + 1} 个文件有 ${sizeMB} MB，超过当前 ${sizeLimitMB} MB 的限制，已跳过。`)
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
                    return `已保存 ${savedCount} 个文件到“${folderName}”分类。`
                } else {
                    return `找不到“${keyword}”分类，已保存 ${savedCount} 个文件到临时目录。`
                }
            } catch (error) {
                return `保存失败：${error.message}`
            }

        })

    // 图库列表指令
    ctx.command(`${config.listCommandName}`)
        .usage(`用法：${config.listCommandName}
列出所有图库分类和别名。之后直接发送关键词，或使用“${config.sendCommandName} 关键词 数量”发图。`)
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
                    return '图库里还没有可用分类。'
                }

                const header = `直接发送下面的关键词，或使用“${config.sendCommandName} 关键词 数量”获取随机图片或视频：`
                return [header, ...messageLines].join('\n')

            } catch (error) {
                return `暂时无法读取图库列表：${error.message}`
            }
        })

    // 刷新图库缓存指令
    ctx.command(`${config.refreshCommandName}`)
        .usage(`用法：${config.refreshCommandName}
新增、删除或重命名分类文件夹后使用，立即更新图库，不需要重启 Koishi。`)
        .action(async ({ session }) => {
            try {
                clearCache()
                const folders = await getFolders()
                const folderCount = folders.filter(f => f.isDirectory()).length
                return `图库已刷新，目前有 ${folderCount} 个分类。`
            } catch (error) {
                return `刷新图库失败：${error.message}`
            }
        })

    // 创建关键词指令
    ctx.command(`${config.createCommandName} <keyword> [aliases...]`)
        .action(async ({ session }, keyword: string, ...aliases: string[]) => {
            if (!keyword) {
                return '请提供分类名称，例如：创建关键词 猫咪 猫图'
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
                return '这个分类名称无法使用，请换一个名称。'
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
                return '这个分类名称或别名已经存在，无法重复创建。'
            }

            const newFolderName = allAliases.join('-')
            const newFolderPath = join(config.imagePath, newFolderName)

            try {
                await fs.mkdir(newFolderPath, { recursive: true })
                clearCache()
                const aliasesText = aliasParts.length > 0 ? `，别名：${aliasParts.join('、')}` : ''
                return `分类“${mainPart}”创建成功${aliasesText}！`
            } catch (error) {
                loginfo('创建分类失败:', error)
                return `创建分类失败：${error.message}`
            }
        })

    // 创建别名指令
    ctx.command(`${config.addAliasCommandName} <keyword> [aliases...]`)
        .action(async ({ session }, keyword: string, ...aliases: string[]) => {
            if (!keyword || aliases.length === 0) {
                return '请提供原关键词和至少一个新别名，例如：创建别名 猫咪 猫图'
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
                return '没有得到有效的新别名，请换一个名称。'
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
                return '没有找到这个分类，请先确认关键词或别名是否写对。'
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
                return '这个别名已经被其他分类使用，无法添加。'
            }

            const newAliases = aliasParts.filter(a => !targetParts.includes(a))
            if (newAliases.length === 0) {
                return '这些别名已经存在于该分类中。'
            }

            const newFolderName = [...targetParts, ...newAliases].join('-')
            const oldPath = join(config.imagePath, targetOldName)
            const newPath = join(config.imagePath, newFolderName)

            try {
                await fs.rename(oldPath, newPath)
                clearCache()
                return `别名添加成功！该分类现在可以用这些词触发：${[...targetParts, ...newAliases].join('、')}。`
            } catch (error) {
                loginfo('创建别名失败:', error)
                return `添加别名失败：${error.message}`
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
                await session.send('这个分类里还没有图片或视频。')
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
例如：${config.sendCommandName} 猫图 或 ${config.sendCommandName} 猫图 3

也可以使用 ${config.listCommandName} 查看所有分类和别名。
直接发送关键词是否触发发图，由设置中的匹配模式决定。`)
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
