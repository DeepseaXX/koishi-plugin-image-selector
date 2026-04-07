import { Context, Schema, h, Session } from 'koishi'

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Dirent } from 'node:fs' 

export const name = 'image-selector'
export const inject = {
    required: ['http', 'logger']
}

export const usage = `
一个图片库管理插件。将图片按文件夹分类存放，发送关键词即可随机发图。

### 常用指令
- **随机 [关键词] [数量]**：直接发送关键词发图,中间的空格可以省略
- **添加 [关键词]**：保存图片或视频到指定分类
- **查看列表**：查看所有可用关键词及别名
- **刷新列表**：新增文件夹后手动刷新缓存
- **添加关键词 [关键词]**：新增一个文件夹
- **添加别名 [关键词/关键词对应的别名] [要添加的别名]**：在此关键词下添加别名


<a target="_blank" href="https://www.npmjs.com/package/@deepseaxx/koishi-plugin-image-selector">➤ 详细配置及进阶用法文档</a>
`

export interface Config {
    // 基础路径与群组映射
    basePath: string
    groupMappings: { groupName: string; guildIds: string[] }[]
    fallbackGroupName: string
    enableForUnmappedGroups: boolean

    // 图库指令
    listCommandName: string
    refreshCommandName: string

    // 发图功能
    sendCommandName: string
    maxout: number
    matchMode: 'fuzzy' | 'exact' | 'none'

    // 存图功能
    saveCommandName: string
    filenameTemplate: string
    promptTimeout: number
    saveFailFallback: boolean

    // 权限设置
    userLimits: { userId: string; sizeLimit: number }[]
    groupLimits: { guildId: string; sizeLimit: number }[]

    // 调试模式
    debugMode: boolean

    // 文件夹创建功能
    createCommandName: string

    // 别名管理功能
    addAliasCommandName: string

    // 聊天记录删除功能
    enableRecordDelete: boolean
    enableRecordSubmit: boolean

    // 猫娘化开关
    nekoMode: boolean
}

export const Config: Schema<Config> = Schema.intersect([
    // 基础路径与群组映射
    Schema.object({
        basePath: Schema.string().required().description('图片库根目录路径，例如 D:\\Bot\\image-selector').role('textarea', { rows: [2, 4] }),
        groupMappings: Schema.array(
            Schema.object({
                groupName: Schema.string().required().description('群组名称（用作文件夹名，例如 group1）'),
                guildIds: Schema.array(Schema.string()).role('table').description('群号列表，一行一个').default([])
            })
        ).description('群组映射配置。每个群组对应一个文件夹，群号列表中的群将使用该群组的图片库。').default([]),
        fallbackGroupName: Schema.string().default('default').description('当群号未匹配任何群组时，使用的默认群组名称'),
        enableForUnmappedGroups: Schema.boolean().default(false).description('是否允许未映射的群组使用插件功能（使用默认文件夹）。如果关闭，则未映射的群组将收到功能未开启的提示。')
    }).description('基础路径与群组映射'),

    // 图库指令
    Schema.object({
        listCommandName: Schema.string().default('查看列表').description('图库列表指令名（可自定义）'),
        refreshCommandName: Schema.string().default('刷新列表').description('刷新图库缓存指令名（可自定义）')
    }).description('图库指令'),

    // 发图功能
    Schema.object({
        sendCommandName: Schema.string().default('随机').description('发图指令名（可自定义）'),
        maxout: Schema.number().default(1).description('单次最大发图数量（可自定义）'),
        matchMode: Schema.union([
            Schema.const('fuzzy' as const).description('模糊匹配：消息以关键词开头即触发'),
            Schema.const('exact' as const).description('精确匹配：仅「关键词」或「关键词 数字」触发'),
            Schema.const('none' as const).description('禁用中间件：关键词不直接触发，仅限指令触发')
        ]).default('none').description('关键词匹配模式')
    }).description('发图功能'),

    // 存图功能
    Schema.object({
        saveCommandName: Schema.string().default('添加').description('存图指令名（可自定义）'),
        filenameTemplate: Schema.string().role('textarea', { rows: [2, 4] })
            .default('${date}-${time}-${index}-${guildId}-${userId}${ext}')
            .description('存图文件名模板，可用变量：${userId} ${username} ${timestamp} ${date} ${time} ${index} ${ext} ${guildId} ${channelId}'),
        promptTimeout: Schema.number().default(30).description('交互式存图的等待超时（秒）'),
        saveFailFallback: Schema.boolean().default(false).description('关键词匹配失败时：开启则存入临时目录，关闭则直接取消')
    }).description('存图功能'),

    // 权限设置
    Schema.object({
        userLimits: Schema.array(Schema.object({
            userId: Schema.string().required().description('用户 ID（填 default 作为全局默认）'),
            sizeLimit: Schema.number().min(0).step(0.1).required().description('上传上限（MB），0 表示禁止上传')
        })).role('table')
            .description('用户上传限制。必须包含 userId 为 default 的行作为全局默认值，0 表示禁止上传。')
            .default([{ userId: 'default', sizeLimit: 0 }]),
        groupLimits: Schema.array(Schema.object({
            guildId: Schema.string().required().description('群组 ID（填 default 作为群组默认）'),
            sizeLimit: Schema.number().min(0).step(0.1).required().description('上传上限（MB），0 表示禁止上传')
        })).role('table')
            .description('群组上传限制。可包含 guildId 为 default 的行作为群组默认值，0 表示禁止上传。')
            .default([{ guildId: 'default', sizeLimit: 0 }])
    }).description('权限设置'),

    // 调试模式
    Schema.object({
        debugMode: Schema.boolean().default(false).description('启用调试日志').experimental()
    }).description('调试模式'),

    //文件夹创建功能
    Schema.object({
        createCommandName: Schema.string().default('添加关键词').description('添加关键词文件夹指令名（可自定义）')
    }).description('文件夹创建功能'),

    // 别名管理功能
    Schema.object({
        addAliasCommandName: Schema.string().default('添加别名').description('添加别名指令名（可自定义）')
    }).description('别名管理功能'),

    // 聊天记录删除功能
    Schema.object({
        enableRecordDelete: Schema.boolean().default(true).description('启用被保存者删除记录功能'),
        enableRecordSubmit: Schema.boolean().default(false).description('启用新增记录（关闭时仅可删除已有记录）')
    }).description('聊天记录删除功能'),

    // 猫娘化开关
    Schema.object({
        nekoMode: Schema.boolean().default(false).description('猫娘化回复：开启时回复带"喵~"等可爱语气，关闭时回复书面化语言')
    }).description('回复风格设置')
])

export function apply(ctx: Context, config: Config) {
    config = config || {} as Config

    const { basePath, groupMappings = [], fallbackGroupName = 'default', enableForUnmappedGroups = true } = config

    const guildToGroup = new Map<string, string>()
    for (const mapping of groupMappings) {
        if (mapping.groupName && Array.isArray(mapping.guildIds)) {
            for (const guildId of mapping.guildIds) {
                guildToGroup.set(guildId, mapping.groupName)
            }
        }
    }

    // 群组发现函数：从磁盘自动扫描已有的群组文件夹
    async function discoverGroupsFromDisk(): Promise<string[]> {
        try {
            const items = await fs.readdir(basePath, { withFileTypes: true })
            const groups: string[] = []
            
            for (const item of items) {
                if (!item.isDirectory()) continue
                
                const groupName = item.name
                // 检查该目录是否包含 images 文件夹（标志是一个有效的群组）
                try {
                    const imagesPath = join(basePath, groupName, 'images')
                    await fs.access(imagesPath)
                    groups.push(groupName)
                    loginfo(`发现群组文件夹: ${groupName}`)
                } catch {
                    // 目录不是有效的群组
                }
            }
            
            return groups
        } catch (error) {
            loginfo(`扫描群组文件夹失败: ${error}`)
            return []
        }
    }

    // 生成群组发现报告
    async function generateGroupDiscoveryReport(): Promise<void> {
        try {
            const discoveredGroups = await discoverGroupsFromDisk()
            const configuredGroups = groupMappings.map(m => m.groupName)
            
            loginfo(`=== 群组发现报告 ===`)
            loginfo(`配置的群组: ${configuredGroups.join(', ') || '(无)'}`)
            loginfo(`磁盘中发现的群组: ${discoveredGroups.join(', ') || '(无)'}`)
            
            // 查找未配置的群组
            const unconfiguredGroups = discoveredGroups.filter(g => !configuredGroups.includes(g))
            if (unconfiguredGroups.length > 0) {
                loginfo(`⚠️  未配置的群组: ${unconfiguredGroups.join(', ')}`)
                loginfo(`    💡 建议在 groupMappings 中添加这些群组的 guildIds 映射`)
            }
            
            // 查找不存在的群组
            const nonexistentGroups = configuredGroups.filter(g => !discoveredGroups.includes(g))
            if (nonexistentGroups.length > 0) {
                loginfo(`⚠️  配置中不存在的群组文件夹: ${nonexistentGroups.join(', ')}`)
                loginfo(`    💡 请检查磁盘路径或删除不再使用的配置`)
            }
            
            if (unconfiguredGroups.length === 0 && nonexistentGroups.length === 0) {
                loginfo(`✨ 所有群组配置都是正确的！`)
            }
        } catch (error) {
            loginfo(`❌ 生成群组发现报告失败: ${error}`)
        }
    }

    // 生成建议的群组映射配置
    async function generateGroupMappingConfig(): Promise<string> {
        try {
            const discoveredGroups = await discoverGroupsFromDisk()
            if (discoveredGroups.length === 0) {
                return '// 未发现任何群组文件夹'
            }

            let configContent = `// 根据磁盘发现的群组自动生成的映射配置\n`
            configContent += `// 编辑此配置并将其添加到插件配置的 groupMappings 中\n`
            configContent += `// 格式: 为每个群组添加对应的 QQ 群 ID (guildIds)\n\n`
            configContent += `groupMappings = [\n`

            for (const group of discoveredGroups) {
                const isConfigured = groupMappings.some(m => m.groupName === group)
                const status = isConfigured ? '' : ' // ⚠️  未配置'
                configContent += `  {\n`
                configContent += `    groupName: '${group}',\n`
                configContent += `    guildIds: [] // 添加要映射到此群组的 QQ 群 ID${status}\n`
                configContent += `  },\n`
            }

            configContent += `]\n`
            return configContent
        } catch (error) {
            loginfo(`❌ 生成群组映射配置失败: ${error}`)
            return '// 生成失败'
        }
    }

    // 自动迁移所有发现的群组
    async function autoMigrateAllGroups(): Promise<void> {
        try {
            const discoveredGroups = await discoverGroupsFromDisk()
            
            if (discoveredGroups.length === 0) {
                loginfo(`📭 未发现任何需要迁移的群组`)
                return
            }
            
            loginfo(`========== 开始自动群组迁移 ==========`)
            loginfo(`🔄 发现 ${discoveredGroups.length} 个群组，准备迁移旧数据...`)
            
            for (const groupName of discoveredGroups) {
                try {
                    await migrateOldRecords(groupName)
                } catch (error) {
                    loginfo(`⚠️  群组 '${groupName}' 迁移过程中出现错误: ${error}`)
                }
            }
            
            loginfo(`✅ 所有群组迁移完成`)
            loginfo(`=====================================`)
        } catch (error) {
            loginfo(`❌ 自动迁移失败: ${error}`)
        }
    }

    function getGroupName(guildId?: string): string {
        if (guildId && guildToGroup.has(guildId)) {
            return guildToGroup.get(guildId)!
        }
        return fallbackGroupName
    }

    function isGroupEnabled(session: Session): boolean {
        if (!session.guildId) {
            return enableForUnmappedGroups
        }
        if (guildToGroup.has(session.guildId)) {
            return true
        }
        return enableForUnmappedGroups
    }

    function formatMessage(nekoText: string, normalText: string): string {
        return config.nekoMode ? nekoText : normalText
    }

    function loginfo(...args: any[]) {
        if (config.debugMode) {
            ctx.logger.info(args.map(String).join(' '))
        }
    }

    function getImagePath(groupName: string): string {
        return join(basePath, groupName, 'images')
    }

    function getTempPath(groupName: string): string {
        return join(basePath, groupName, 'temp')
    }

    function getAliasConfigPath(groupName: string): string {
        return join(basePath, groupName, 'alias-config.json')
    }

    function getRecordsConfigPath(groupName: string): string {
        return join(basePath, groupName, 'records-config.json')
    }

    // 聊天记录配置接口
    interface RecordConfig {
        groupId: string
        recordedUserId: string      // 被保存人的 ID
        recordedUserName: string    // 被保存人的名字
        keyword: string             // 关键词（对应文件夹）
        files: {
            filename: string
            uploadTime: number
        }[]
    }

    // 别名配置接口
    interface AliasConfig {
        keyword: string
        aliases: string[]
    }

    // 加载别名配置
    async function loadAliasConfig(groupName: string): Promise<AliasConfig[]> {
        const configPath = getAliasConfigPath(groupName)
        try {
            const data = await fs.readFile(configPath, 'utf-8')
            return JSON.parse(data)
        } catch (err) {
            loginfo(`别名配置文件不存在或读取失败，返回空数组 for group ${groupName}`)
            return []
        }
    }

    // 保存别名配置
    async function saveAliasConfig(groupName: string, aliasConfig: AliasConfig[]): Promise<void> {
        const configPath = getAliasConfigPath(groupName)
        const dir = basePath
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(configPath, JSON.stringify(aliasConfig, null, 2), 'utf-8')
        loginfo(`别名配置已保存 for group ${groupName}`)
    }

    // 查询关键词及其所有别名
    async function findKeywordConfig(keyword: string, groupName: string): Promise<AliasConfig | null> {
        const aliasConfig = await loadAliasConfig(groupName)
        for (const item of aliasConfig) {
            if (item.keyword === keyword || item.aliases.includes(keyword)) {
                return item
            }
        }
        return null
    }

    // 加载聊天记录配置
    async function loadRecordsConfig(groupName: string): Promise<RecordConfig[]> {
        const configPath = getRecordsConfigPath(groupName)
        try {
            const data = await fs.readFile(configPath, 'utf-8')
            return JSON.parse(data)
        } catch (err) {
            loginfo(`聊天记录配置文件不存在或读取失败，返回空数组 for group ${groupName}`)
            return []
        }
    }

    // 保存聊天记录配置
    async function saveRecordsConfig(groupName: string, recordsConfig: RecordConfig[]): Promise<void> {
        const configPath = getRecordsConfigPath(groupName)
        const dir = basePath
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(configPath, JSON.stringify(recordsConfig, null, 2), 'utf-8')
        loginfo(`聊天记录配置已保存 for group ${groupName}`)
    }

    // 查找文件所属的记录配置
    async function findRecordByFile(filename: string, groupName: string): Promise<{ recordConfig: RecordConfig; fileIndex: number } | null> {
        const recordsConfig = await loadRecordsConfig(groupName)
        for (const record of recordsConfig) {
            const fileIndex = record.files.findIndex(f => f.filename === filename)
            if (fileIndex !== -1) {
                return { recordConfig: record, fileIndex }
            }
        }
        return null
    }

    // 数据迁移函数：从已有图片文件夹和JSON配置生成初始 records-config.json
    // 同时将旧的文件夹名格式（keyword-alias1-alias2）转换为JSON配置格式
    async function migrateOldRecords(groupName: string): Promise<void> {
        const configPath = getRecordsConfigPath(groupName)
        const aliasConfigPath = getAliasConfigPath(groupName)
        
        try {
            // 检查配置文件是否已存在
            await fs.access(configPath)
            loginfo(`records-config.json 已存在，跳过迁移 for group ${groupName}`)
            return
        } catch {
            // 文件不存在，需要迁移
        }

        try {
            loginfo(`开始迁移旧数据 for group ${groupName}`)
            const imagePath = getImagePath(groupName)
            const recordsConfig: RecordConfig[] = []

            // 首先检查 alias-config.json 是否存在
            let aliasConfig: AliasConfig[] = []
            try {
                const aliasData = await fs.readFile(aliasConfigPath, 'utf-8')
                aliasConfig = JSON.parse(aliasData)
                loginfo(`成功读取现有别名配置，包含 ${aliasConfig.length} 个关键词`)
            } catch (err) {
                loginfo(`别名配置文件不存在或读取失败，将从文件夹扫描生成`)
            }

            // 如果没有 alias-config.json，从实际文件夹结构生成配置
            if (aliasConfig.length === 0) {
                try {
                    const folder = await fs.readdir(imagePath, { withFileTypes: true })
                    const folders = folder.filter(f => f.isDirectory()).map(f => f.name)

                    for (const folderName of folders) {
                        // 解析旧格式文件夹名: keyword-alias1-alias2...
                        const parts = folderName.split('-')
                        const keyword = parts[0]
                        const aliases = parts.slice(1)

                        // 检查是否已有该关键词
                        let existingKeyword = aliasConfig.find(item => item.keyword === keyword)
                        if (!existingKeyword) {
                            existingKeyword = {
                                keyword: keyword,
                                aliases: []
                            }
                            aliasConfig.push(existingKeyword)
                        }

                        // 合并别名
                        for (const alias of aliases) {
                            if (!existingKeyword.aliases.includes(alias)) {
                                existingKeyword.aliases.push(alias)
                            }
                        }

                        loginfo(`从文件夹解析: ${folderName} => 关键词: ${keyword}, 别名: ${aliases.join(', ')}`)
                    }

                    // 保存生成的别名配置
                    if (aliasConfig.length > 0) {
                        await saveAliasConfig(groupName, aliasConfig)
                        loginfo(`生成别名配置成功，包含 ${aliasConfig.length} 个关键词`)
                    }
                } catch (err: any) {
                    loginfo(`从文件夹扫描生成别名配置失败: ${err.message}`)
                }
            }

            // 为所有关键词生成迁移记录
            for (const item of aliasConfig) {
                const keywordPath = join(imagePath, item.keyword)
                try {
                    const files = await fs.readdir(keywordPath)
                    const mediaFiles = files.filter(file =>
                        /\.(jpe?g|png|gif|webp|mp4|mov|avi|bmp|tiff?)$/i.test(file)
                    )

                    if (mediaFiles.length === 0) continue

                    // 为这个关键词创建一条通用迁移记录
                    const migrationRecord: RecordConfig = {
                        groupId: 'migrated',
                        recordedUserId: 'unknown', // 标记为来自旧版本
                        recordedUserName: '旧版数据',
                        keyword: item.keyword,
                        files: mediaFiles.map(file => ({
                            filename: file,
                            uploadTime: 0 // 无法获知上传时间
                        }))
                    }
                    recordsConfig.push(migrationRecord)
                    loginfo(`迁移了 ${mediaFiles.length} 个文件到关键词 "${item.keyword}"`)
                } catch (err: any) {
                    if (config.debugMode) {
                        loginfo(`扫描关键词文件夹失败: ${item.keyword}`, err.message)
                    }
                }
            }

            // 保存迁移后的数据
            if (recordsConfig.length > 0) {
                await saveRecordsConfig(groupName, recordsConfig)
                loginfo(`数据迁移完成，生成了 ${recordsConfig.length} 条记录 for group ${groupName}`)
            } else {
                // 即使没有数据，也创建空配置文件以标记已迁移
                await saveRecordsConfig(groupName, [])
                loginfo(`未找到可迁移的数据 for group ${groupName}`)
            }
        } catch (err: any) {
            ctx.logger.warn(`数据迁移失败，将继续运行: ${err.message}`)
            // 不中断插件启动
        }
    }

    const folderCacheMap = new Map<string, { folders: Dirent[]; timestamp: number }>()
    const CACHE_TTL = 5 * 60 * 1000 // 5分钟缓存

    async function getFolders(groupName: string): Promise<Dirent[]> {
        const now = Date.now()
        const cached = folderCacheMap.get(groupName)
        if (cached && now - cached.timestamp <= CACHE_TTL) {
            loginfo(`使用缓存的文件夹列表 for group ${groupName}`)
            return cached.folders
        }
        loginfo(`缓存已过期或不存在，重新读取文件夹列表 for group ${groupName}`)
        const imagePath = getImagePath(groupName)
        let folders: Dirent[] = []
        try {
            folders = await fs.readdir(imagePath, { withFileTypes: true })
        } catch (err: any) {
            loginfo(`读取图片库失败 for group ${groupName}:`, err.message)
            folders = []
        }
        folderCacheMap.set(groupName, { folders, timestamp: now })
        loginfo(`已缓存 ${folders.length} 个文件夹 for group ${groupName}`)
        return folders
    }

    function clearCache(groupName?: string) {
        if (groupName) {
            folderCacheMap.delete(groupName)
            loginfo(`文件夹缓存已清除 for group ${groupName}`)
        } else {
            folderCacheMap.clear()
            loginfo('所有文件夹缓存已清除')
        }
    }

    const getFileExtension = (file: any, imgType: string): string => {
        loginfo('文件信息:', JSON.stringify(file, null, 2))
        let detectedExtension = ''

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
        } /*else if (mimeType === 'video/mp4') {
            detectedExtension = '.mp4'
        } else if (mimeType === 'video/quicktime') {
            detectedExtension = '.mov'
        } else if (mimeType === 'video/x-msvideo') {
            detectedExtension = '.avi'
        } */else if (mimeType) {
            loginfo(`未知的文件类型，file.type=${file.type}, file.mime=${file.mime}`)
            detectedExtension = imgType === 'video' ? '.mp4' : '.jpg'
        } else {
            loginfo(`无法检测到文件类型，file.type=${file.type}, file.mime=${file.mime}`)
            detectedExtension = imgType === 'video' ? '.mp4' : '.jpg'
        }

        loginfo('检测到的文件扩展名:', detectedExtension)
        return detectedExtension
    }

    // 统计文件夹文件数量
    async function countMediaFilesInFolder(folderPath: string): Promise<number> {
        try {
            const files = await fs.readdir(folderPath)
            const mediaFiles = files.filter(file =>
                /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(file)
            )
            return mediaFiles.length
        } catch (error) {
            loginfo(`统计文件夹 ${folderPath} 媒体文件数量失败:`, error)
            return 0
        }
    }

    // 查找角色名称匹配的文件夹
    async function findCharacterFolder(characterName: string, groupName: string): Promise<string | null> {
        try {
            const aliasConfig = await loadAliasConfig(groupName)
            for (const item of aliasConfig) {
                if (item.keyword === characterName || item.aliases.includes(characterName)) {
                    return item.keyword
                }
            }
            return null
        } catch (error) {
            loginfo('查找角色文件夹失败:', error)
            return null
        }
    }

    //存图指令
    ctx.command(`${config.saveCommandName} [关键词] [...图片]`, { captureQuote: false })
        .userFields(['id', 'name', 'authority'])
        .action(async ({ session }, keyword?: string, ...图片: string[]) => {
            if (!isGroupEnabled(session)) {
                return formatMessage(
                    '该功能未在此群开启，去联系Bot管理员看看吧~',
                    '该功能未在此群开启，可联系Bot管理员开启。'
                )
            }

            const groupName = getGroupName(session.guildId)

            // 预处理：检查第一参数是否为图片
            if (keyword) {
                const elements = h.parse(keyword)
                if (elements.some(el => ['img', 'mface', 'image', 'video'].includes(el.type))) {
                    图片.unshift(keyword)
                    keyword = undefined
                }
            }

            // 优先检查引用消息中的图片
            if (session.quote) {
                loginfo('检测到引用消息，尝试从引用消息中提取图片')
                const quoteElements = h.parse(session.quote.content)
                const quoteImages = quoteElements.filter(el => ['img', 'mface', 'image', 'video'].includes(el.type))

                if (quoteImages.length > 0) {
                    loginfo('从引用消息中找到图片:', quoteImages.length, '个')
                    图片 = [session.quote.content]
                }
            }

            // 解析所有图片参数
            let allImages: any[] = []
            for (const 图片Item of 图片) {
                const elements = h.parse(图片Item)
                const images = elements.filter(el => ['img', 'mface', 'image', 'video'].includes(el.type))
                allImages.push(...images)
            }

            // 如果没有图片(参数或引用)，尝试交互式获取
            if (allImages.length === 0) {
                await session.send(formatMessage('请发送图片喵~', '请发送图片。'))
                const promptResult = await session.prompt(config.promptTimeout * 1000)
                if (!promptResult) {
                    return formatMessage('未收到图片喵...', '未收到图片，操作已取消。')
                }
                const elements = h.parse(promptResult)
                const images = elements.filter(el => ['img', 'mface', 'image', 'video'].includes(el.type))
                allImages.push(...images)
            }

            if (allImages.length === 0) {
                return formatMessage('未收到有效的图片喵...', '未收到有效的图片，操作已取消。')
            }

            // 检查是否已有分类（关键词），如果没有则询问
            if (!keyword) {
                await session.send(formatMessage(
                    '请回复要保存的关键词（等待30秒超时）',
                    '请回复要保存的关键词（等待30秒超时）'
                ))
                const reply = await session.prompt(30 * 1000)
                if (!reply) {
                    return formatMessage('等待超时，未执行保存喵~', '等待超时，未执行保存操作。')
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
                return formatMessage(
                    '当前用户无上传权限或已被禁止上传喵！',
                    '当前用户无上传权限或已被禁止上传。'
                )
            }
            loginfo(`用户 ${userId} 上传限制: ${sizeLimitMB}MB`)
            const sizeLimitBytes = sizeLimitMB * 1024 * 1024

            try {
                let targetPath = getTempPath(groupName)
                let folderName = ''
                let matched = false

                // 尝试在JSON配置中匹配关键词
                if (keyword) {
                    const aliasConfig = await loadAliasConfig(groupName)
                    for (const item of aliasConfig) {
                        if (item.keyword === keyword || item.aliases.includes(keyword)) {
                            folderName = item.keyword
                            targetPath = join(getImagePath(groupName), folderName)
                            matched = true
                            loginfo('从别名配置匹配到关键词:', folderName)
                            break
                        }
                    }

                    if (!matched) {
                        if (!config.saveFailFallback) {
                            return formatMessage(
                                `没有找到关键词呢...`,
                                `未找到关键词"${keyword}"，保存失败。`
                            )
                        }
                        loginfo(`没有找到关键词呢...`)
                    }
                }

                // 确保目标路径存在
                await fs.mkdir(targetPath, { recursive: true })

                const baseTimestamp = Date.now()
                let savedCount = 0
                const savedFilenames: string[] = []

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
                        await session.send(formatMessage(
                            `文件 ${i + 1} 大小(${sizeMB}MB)超出限制(${sizeLimitMB}MB)，已跳过喵~`,
                            `文件 ${i + 1} 大小(${sizeMB}MB)超出限制(${sizeLimitMB}MB)，已跳过。`
                        ))
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
                    savedFilenames.push(filename)

                    loginfo(`保存文件 ${i + 1}/${allImages.length}:`, filename)
                }

                if (matched) {
                    const mediaCount = await countMediaFilesInFolder(targetPath)
                    
                    // 仅在启用 Record Submit 时记录被保存人信息
                    if (config.enableRecordSubmit && savedCount > 0) {
                        try {
                            const recordsConfig = await loadRecordsConfig(groupName)
                            
                            // 查找或创建该用户的记录
                            let userRecord = recordsConfig.find(r => r.recordedUserId === userId && r.keyword === folderName)
                            
                            if (!userRecord) {
                                userRecord = {
                                    groupId: guildId || 'private',
                                    recordedUserId: userId,
                                    recordedUserName: session.username || userId,
                                    keyword: folderName,
                                    files: []
                                }
                                recordsConfig.push(userRecord)
                            }
                            
                            // 添加新保存的文件到记录
                            for (let i = 0; i < savedFilenames.length; i++) {
                                userRecord.files.push({
                                    filename: savedFilenames[i],
                                    uploadTime: baseTimestamp + i
                                })
                            }
                            
                            await saveRecordsConfig(groupName, recordsConfig)
                            loginfo(`已记录 ${savedCount} 个文件到被保存人 ${userId}`)
                        } catch (err) {
                            loginfo('记录被保存人信息失败:', err)
                            // 不影响存图成功
                        }
                    } else if (!config.enableRecordSubmit && savedCount > 0) {
                        loginfo(`记录功能已禁用，不记录本次保存操作`)
                    }
                    
                    return formatMessage(`保存成功了喵~，现在有 ${mediaCount} 张图片呢~`, `保存成功，现在有 ${mediaCount} 张图片。`)
                } else {
                    return formatMessage('保存失败了喵...是不是名字写错了呢~', '保存失败，可能是关键词不存在。')
                }
            } catch (error) {
                return formatMessage(`保存失败: ${error.message}`, `保存失败: ${error.message}`)
            }
        })

    //添加别名指令
    ctx.command(`${config.addAliasCommandName} <keyword> <alias>`)
        .userFields(['id', 'authority'])
        .action(async ({ session }, keyword: string, alias: string) => {
            if (!isGroupEnabled(session)) {
                return formatMessage(
                    '该功能未在此群开启，去联系Bot管理员看看吧~',
                    '该功能未在此群开启，可联系Bot管理员开启。'
                )
            }
            const groupName = getGroupName(session.guildId)

            if (!keyword || !alias) {
                return formatMessage('请指定关键词和别名喵...', '请指定关键词和别名。')
            }

            const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_')
            const sanitizedAlias = sanitize(alias)
            if (sanitizedAlias.length === 0) {
                return formatMessage('别名包含非法字符喵！', '别名包含非法字符，无法使用。')
            }

            // 从JSON配置查询关键词
            const aliasConfig = await loadAliasConfig(groupName)
            let configItem = aliasConfig.find(item => item.keyword === keyword || item.aliases.includes(keyword))
            
            if (!configItem) {
                return formatMessage(
                    `未找到关键词 "${keyword}" 对应的配置呢...`,
                    `未找到关键词 "${keyword}" 对应的配置。`
                )
            }

            // 主关键词是 configItem.keyword
            const mainKeyword = configItem.keyword

            if (configItem.aliases.includes(sanitizedAlias) || sanitizedAlias === mainKeyword) {
                return formatMessage(
                    `别名 "${alias}" 已存在，不要重复添加喵！`,
                    `别名 "${alias}" 已存在，请勿重复添加。`
                )
            }

            // 检查是否与JSON配置中的其他关键词冲突
            for (const item of aliasConfig) {
                if (item.keyword === sanitizedAlias || item.aliases.includes(sanitizedAlias)) {
                    return formatMessage(
                        `别名 "${alias}" 与现有关键词或别名冲突喵！`,
                        `别名 "${alias}" 与现有关键词或别名冲突，无法添加。`
                    )
                }
            }

            // 检查整个文件夹系统中是否已存在该别名
            // 这确保了即使 JSON 配置不完整，也能检测到别名冲突
            try {
                const imagePath = getImagePath(groupName)
                const folder = await fs.readdir(imagePath, { withFileTypes: true })
                const folders = folder.filter(f => f.isDirectory()).map(f => f.name)
                
                for (const folderName of folders) {
                    // 解析文件夹名中包含的所有别名部分
                    const parts = folderName.split('-')
                    if (parts.includes(sanitizedAlias)) {
                        return formatMessage(
                            `别名 "${alias}" 在实际文件夹中已存在喵！`,
                            `别名 "${alias}" 在实际文件夹中已存在，无法添加。`
                        )
                    }
                }
            } catch (err: any) {
                if (config.debugMode) {
                    loginfo(`检查文件夹系统时出错: ${err.message}`)
                }
            }

            try {
                // 添加到别名列表
                configItem.aliases.push(sanitizedAlias)
                await saveAliasConfig(groupName, aliasConfig)
                
                return formatMessage(
                    `别名 "${alias}" 添加成功喵！该关键词现在有别名：${configItem.aliases.join('、')}喵~`,
                    `别名 "${alias}" 添加成功，该关键词现在有别名：${configItem.aliases.join('、')}`
                )
            } catch (error: any) {
                ctx.logger.error('添加别名失败', error)
                return formatMessage(`添加别名失败: ${error.message}`, `添加别名失败: ${error.message}`)
            }
        })

    // 创建关键词指令
    ctx.command(`${config.createCommandName} <keyword> [aliases...]`)
        .userFields(['id', 'authority'])
        .action(async ({ session }, keyword: string, ...aliases: string[]) => {
            if (!isGroupEnabled(session)) {
                return formatMessage(
                    '该功能未在此群开启，去联系Bot管理员看看吧~',
                    '该功能未在此群开启，可联系Bot管理员开启。'
                )
            }
            const groupName = getGroupName(session.guildId)

            if (!keyword) {
                return formatMessage('请指定关键词喵~', '请指定关键词。')
            }

            const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_')
            const mainPart = sanitize(keyword)
            const aliasParts = aliases.map(a => sanitize(a)).filter(a => a.length > 0)

            if (mainPart.length === 0) {
                return formatMessage('关键词无效（过滤后为空）。', '关键词无效（过滤后为空）。')
            }

            try {
                // 加载已有配置
                const aliasConfig = await loadAliasConfig(groupName)
                
                // 检查主关键词是否已存在
                if (aliasConfig.some(item => item.keyword === mainPart)) {
                    return formatMessage(
                        `主关键词「${mainPart}」已存在喵！`,
                        `主关键词「${mainPart}」已存在。`
                    )
                }

                // 检查别名冲突
                for (const newAlias of aliasParts) {
                    if (aliasConfig.some(item => item.keyword === newAlias || item.aliases.includes(newAlias))) {
                        return formatMessage(
                            `别名「${newAlias}」与现有关键词或别名冲突喵！`,
                            `别名「${newAlias}」与现有关键词或别名冲突。`
                        )
                    }
                }

                // 扫描文件夹系统中的所有部分，确保没有冲突
                // 包括处理旧的格式文件夹名 (keyword-alias1-alias2)
                const allParts = [mainPart, ...aliasParts]
                try {
                    const imagePath = getImagePath(groupName)
                    const folder = await fs.readdir(imagePath, { withFileTypes: true })
                    const folders = folder.filter(f => f.isDirectory()).map(f => f.name)
                    
                    for (const folderName of folders) {
                        // 解析文件夹名中的所有部分
                        const folderParts = folderName.split('-')
                        
                        for (const part of allParts) {
                            if (folderParts.includes(part)) {
                                return formatMessage(
                                    `「${part}」在实际文件夹系统中已存在喵！无法创建。`,
                                    `「${part}」在实际文件夹系统中已存在，无法创建。`
                                )
                            }
                        }
                    }
                } catch (err: any) {
                    if (config.debugMode) {
                        loginfo(`检查文件夹系统时出错: ${err.message}`)
                    }
                }

                // 创建文件夹
                const targetPath = join(getImagePath(groupName), mainPart)
                await fs.mkdir(targetPath, { recursive: true })

                // 添加配置项
                aliasConfig.push({
                    keyword: mainPart,
                    aliases: aliasParts
                })
                await saveAliasConfig(groupName, aliasConfig)
                clearCache(groupName)

                const aliasesText = aliasParts.length > 0 ? `，别名：${aliasParts.join('、')}` : ''
                return formatMessage(
                    `关键词「${mainPart}」创建成功喵${aliasesText}！`,
                    `关键词「${mainPart}」创建成功${aliasesText}！`
                )
            } catch (error: any) {
                ctx.logger.error('创建关键词失败', error)
                return formatMessage(`创建失败: ${error.message}`, `创建失败: ${error.message}`)
            }
        })

    //图库列表指令
    ctx.command(`${config.listCommandName}`)
        .action(async ({ session }) => {
            if (!isGroupEnabled(session)) {
                return formatMessage(
                    '该功能未在此群开启，去联系Bot管理员看看吧~',
                    '该功能未在此群开启，可联系Bot管理员开启。'
                )
            }
            const groupName = getGroupName(session.guildId)

            try {
                const aliasConfig = await loadAliasConfig(groupName)
                if (aliasConfig.length === 0) {
                    return formatMessage('图库为空呢...', '图库为空。')
                }

                const messageLines: string[] = []
                let totalMediaCount = 0

                for (const item of aliasConfig) {
                    const folderPath = join(getImagePath(groupName), item.keyword)
                    const mediaCount = await countMediaFilesInFolder(folderPath)
                    totalMediaCount += mediaCount

                    let line = item.keyword
                    if (item.aliases.length > 0) {
                        line += ` 别名：${item.aliases.join(', ')}`
                    }
                    line += '   '
                    
                    if (mediaCount === 0) {
                        line += formatMessage('还没有图片呢...', '暂无图片。')
                    } else {
                        line += `有${mediaCount}张图片`
                    }
                    messageLines.push(line)
                }

                const header = `发送指令或别名随机返回图片，也可使用"${config.sendCommandName} 关键词 数量"`
                const footer = `总共有 ${totalMediaCount} 张图片喵~`
                return [header, ...messageLines, footer].join('\n')

            } catch (error: any) {
                return `获取列表失败: ${error.message}`
            }
        })

    //刷新图库缓存指令
    ctx.command(`${config.refreshCommandName}`)
        .usage(`用法：${config.refreshCommandName}
手动刷新文件夹缓存。添加、删除或重命名分类文件夹后执行，立即生效无需重启。`)
        .action(async ({ session }) => {
            if (!isGroupEnabled(session)) {
                return formatMessage(
                    '该功能未在此群开启，去联系Bot管理员看看吧~',
                    '该功能未在此群开启，请联系Bot管理员。'
                )
            }
            const groupName = getGroupName(session.guildId)
            try {
                clearCache(groupName)
                const aliasConfig = await loadAliasConfig(groupName)
                const keywordCount = aliasConfig.length
                return formatMessage(
                    `图库缓存已刷新，当前共有 ${keywordCount} 个关键词`,
                    `图库缓存已刷新，当前共有 ${keywordCount} 个关键词。`
                )
            } catch (error: any) {
                return formatMessage(`刷新失败: ${error.message}`, `刷新失败: ${error.message}`)
            }
        })

    //发图核心处理函数
    async function processImageRequest(session: Session, input: string, groupName: string, sendPrompt: boolean = true): Promise<boolean> {
        if (!isGroupEnabled(session)) {
            if (sendPrompt) {
                await session.send(formatMessage(
                    '该功能未在此群开启，去联系Bot管理员看看吧~',
                    '该功能未在此群开启，请联系Bot管理员。'
                ))
            }
            return false
        }
        if (!input) return false

        try {
            const aliasConfig = await loadAliasConfig(groupName)
            const useExactMatch = config.matchMode === 'exact'

            // 寻找所有可能的匹配
            const possibleMatches: { keyword: string; matchedAlias: string; suffix: string; aliasLength: number }[] = []

            for (const item of aliasConfig) {
                // 校验该关键词对应的文件夹是否存在
                const folderPath = join(getImagePath(groupName), item.keyword)
                try {
                    await fs.access(folderPath)
                } catch {
                    continue // 文件夹不存在，跳过
                }

                // 检查主关键词
                if (useExactMatch) {
                    if (input === item.keyword) {
                        possibleMatches.push({ keyword: item.keyword, matchedAlias: item.keyword, suffix: '', aliasLength: item.keyword.length })
                    } else if (input.startsWith(item.keyword + ' ')) {
                        const suffix = input.slice(item.keyword.length + 1).trim()
                        if (/^\d*$/.test(suffix)) {
                            possibleMatches.push({ keyword: item.keyword, matchedAlias: item.keyword, suffix, aliasLength: item.keyword.length })
                        }
                    }
                } else {
                    if (input.startsWith(item.keyword)) {
                        const suffix = input.slice(item.keyword.length).trim()
                        possibleMatches.push({ keyword: item.keyword, matchedAlias: item.keyword, suffix, aliasLength: item.keyword.length })
                    }
                }

                // 检查别名
                for (const alias of item.aliases) {
                    if (useExactMatch) {
                        if (input === alias) {
                            possibleMatches.push({ keyword: item.keyword, matchedAlias: alias, suffix: '', aliasLength: alias.length })
                        } else if (input.startsWith(alias + ' ')) {
                            const suffix = input.slice(alias.length + 1).trim()
                            if (/^\d*$/.test(suffix)) {
                                possibleMatches.push({ keyword: item.keyword, matchedAlias: alias, suffix, aliasLength: alias.length })
                            }
                        }
                    } else {
                        if (input.startsWith(alias)) {
                            const suffix = input.slice(alias.length).trim()
                            possibleMatches.push({ keyword: item.keyword, matchedAlias: alias, suffix, aliasLength: alias.length })
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

            // 收集所有具有相同最长别名的匹配
            const bestMatches = possibleMatches.filter(m => m.aliasLength === bestMatch.aliasLength && m.matchedAlias === bestMatch.matchedAlias)

            // 随机选择一个
            const selectedMatch = bestMatches[Math.floor(Math.random() * bestMatches.length)]

            const { keyword, suffix } = selectedMatch

            loginfo('匹配结果:', { keyword, matchedAlias: selectedMatch.matchedAlias, suffix })
            if (bestMatches.length > 1) {
                ctx.logger.warn(`检测到别名重名: "${selectedMatch.matchedAlias}" 匹配到 ${bestMatches.length} 个关键词`)
            }

            let count = 1
            if (suffix && /^\d+$/.test(suffix)) {
                count = Math.min(parseInt(suffix, 10), config.maxout)
            }

            if (count > config.maxout) {
                count = config.maxout
            }

            loginfo(`请求图片数量: ${count} (Max: ${config.maxout})`)

            const folderPath = join(getImagePath(groupName), keyword)
            const files = await fs.readdir(folderPath)
            const mediaFiles = files.filter(file =>
                /\.(jpe?g|png|gif|webp|mp4|mov|avi|bmp|tiff?)$/i.test(file)
            )

            if (mediaFiles.length === 0) {
                await session.send('该文件夹暂无图片或视频')
                return true
            }

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

    //发图指令
    ctx.command(`${config.sendCommandName} <keyword:text>`)
        .action(async ({ session }, keyword: string) => {
            if (!keyword) {
                await session.execute(`${config.sendCommandName} -h`)
                return
            }
            const groupName = getGroupName(session.guildId)
            await processImageRequest(session, keyword, groupName, true)
        })

    // 删除记录中间件
    ctx.middleware(async (session, next) => {
        // 检查是否启用了删除功能
        if (!config.enableRecordDelete) return next()

        const input = session.stripped.content.trim()
        
        // 检查是否是删除指令
        if (input === '删除' || input === 'delete' || input === '删') {
            // 检查是否有被引用的消息
            if (!session.quote) {
                return next()
            }

            const groupName = getGroupName(session.guildId)
            const userId = session.userId

            try {
                // 首次调用时进行数据迁移
                await migrateOldRecords(groupName)

                // 获取被引用消息的内容，提取图片信息
                const quoteContent = session.quote.content
                const elements = h.parse(quoteContent)
                const imageElements = elements.filter(el => ['img', 'mface', 'image'].includes(el.type))

                if (imageElements.length === 0) {
                    return next()
                }

                // 尝试从被引用消息中获取文件路径信息
                // 这里需要从 session.quote 中获取原始的图片文件信息
                const quoteId = session.quote.id || session.quote.messageId || ''
                
                // 加载记录配置
                const recordsConfig = await loadRecordsConfig(groupName)
                
                // 查找该用户创建或可以删除的记录
                let deletedCount = 0
                for (let i = recordsConfig.length - 1; i >= 0; i--) {
                    const record = recordsConfig[i]
                    
                    // 检查是否可以删除此记录
                    let canDelete = false
                    
                    if (record.recordedUserId === 'unknown') {
                        // 旧格式的迁移数据，只允许管理员或拥有权限的用户删除
                        // 这里允许任何人删除，但可以添加权限验证
                        canDelete = true
                    } else if (record.recordedUserId === userId) {
                        // 新格式的数据，只允许原上传者删除
                        canDelete = true
                    }
                    
                    if (!canDelete) continue

                    // 尝试删除该记录下的最新文件
                    const folderPath = join(getImagePath(groupName), record.keyword)
                    
                    for (let j = record.files.length - 1; j >= 0; j--) {
                        const file = record.files[j]
                        const filePath = join(folderPath, file.filename)
                        
                        try {
                            // 删除文件
                            await fs.unlink(filePath)
                            // 从配置中删除记录
                            record.files.splice(j, 1)
                            deletedCount++
                            
                            // 标记删除原因
                            const sourceInfo = record.recordedUserId === 'unknown' ? ' (旧版数据)' : ''
                            loginfo(`已删除文件: ${file.filename} for user ${userId}${sourceInfo}`)
                            
                            // 如果该记录下没有文件了，删除整个记录
                            if (record.files.length === 0) {
                                recordsConfig.splice(i, 1)
                            }
                            
                            // 只删除一个最新的
                            break
                        } catch (err) {
                            loginfo(`删除文件失败: ${file.filename}`, err)
                        }
                    }

                    if (deletedCount > 0) {
                        break
                    }
                }

                if (deletedCount > 0) {
                    await saveRecordsConfig(groupName, recordsConfig)
                    await session.send(formatMessage(
                        `已删除您的 ${deletedCount} 条图片记录喵~`,
                        `已删除您的 ${deletedCount} 条图片记录。`
                    ))
                    return false
                } else {
                    await session.send(formatMessage(
                        `没有找到属于您的图片记录呢...`,
                        `没有找到属于您的图片记录。`
                    ))
                    return false
                }
            } catch (error) {
                loginfo('删除记录失败:', error)
                await session.send(formatMessage(
                    `删除失败了喵...${error.message}`,
                    `删除失败: ${error.message}`
                ))
                return false
            }
        }

        return next()
    }, true)

    //发图中间件
    ctx.middleware(async (session, next) => {
        const input = session.stripped.content.trim()
        
        if (!input) return next()

        const cmdName = config.sendCommandName
        // 处理"发图"开头的消息
        if (input.startsWith(cmdName)) {
            let keyword = input.slice(cmdName.length).trim()

            if (!keyword) {
                await session.send(formatMessage(`请指定关键词喵...`, `请指定关键词。`))
                return
            }
            const groupName = getGroupName(session.guildId)
            const processed = await processImageRequest(session, keyword, groupName, true)

            if (!processed) {
                await session.send(`未找到关键词"${keyword}"对应的图片`)
            }
            return
        }

        if (config.matchMode === 'none') return next()

        const groupName = getGroupName(session.guildId)
        const processed = await processImageRequest(session, input, groupName, true)

        if (processed) {
            return
        } else {
            return next()
        }
    }, true)

    //查找文件夹辅助函数（需要群组）
    async function findFolder(keyword: string, groupName: string): Promise<{ rootPath: string; folderName: string } | null> {
        try {
            // 从JSON配置查询
            const aliasConfig = await loadAliasConfig(groupName)
            for (const item of aliasConfig) {
                if (item.keyword === keyword || item.aliases.includes(keyword)) {
                    const imagePath = getImagePath(groupName)
                    return { rootPath: imagePath, folderName: item.keyword }
                }
            }
        } catch (error) {
            loginfo('从配置查找文件夹失败:', error)
        }

        return null
    }

    // ========== 插件启动时的初始化 ==========
    // 在插件启动时自动发现所有群组并执行数据迁移
    ctx.on('ready', async () => {
        loginfo('\n========== 开始插件初始化 ==========')
        
        // 1. 生成群组发现报告
        await generateGroupDiscoveryReport()
        
        // 2. 自动迁移所有发现的群组
        if (config.enableRecordSubmit || config.enableRecordDelete) {
            await autoMigrateAllGroups()
        }
        
        // 3. 如果启用了调试模式，生成建议的群组映射配置
        if (config.debugMode) {
            const mappingConfig = await generateGroupMappingConfig()
            loginfo('建议的群组映射配置（调试用）：\n' + mappingConfig)
        }
        
        loginfo('========== 插件初始化完成 ==========\n')
    })
}
