import { Context, Schema, h, Session } from 'koishi'

import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export const name = 'image-selector'
export const inject = {
  required: ['http', 'logger']
};

export const usage = `
---

<a target="_blank" href="https://www.npmjs.com/package/@deepseaxx/koishi-plugin-image-selector">➤ 食用方法点此获取</a>

---
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

  userLimits: { userId: string; sizeLimit: number }[]
  groupLimits: { guildId: string; sizeLimit: number }[]
  maxout: number
  debugMode: boolean
}

export const Config: Schema<Config> =
  Schema.intersect([
    Schema.object({
      listCommandName: Schema.string().default('图库列表').description('图库列表指令名称'),
    }).description('图库列表'),
    Schema.object({
      sendCommandName: Schema.string().default('发图').description('发图指令名称'),
      maxout: Schema.number().default(5).description('一次最大输出图片数量'),
      imagePath: Schema.string().required().description('图片库路径').role('textarea', { rows: [2, 4] }),
    }).description('发图功能'),
    Schema.object({
      saveCommandName: Schema.string().default('存图').description('存图指令名称'),
      tempPath: Schema.string().required().description('临时存储路径').role('textarea', { rows: [2, 4] }),
      filenameTemplate: Schema.string().role('textarea', { rows: [2, 4] })
        .default("${date}-${time}-${index}-${guildId}-${userId}${ext}").description('文件名模板，支持变量: ${userId}, ${username}, ${timestamp}, ${date}, ${time}, ${index}, ${ext}, ${guildId}, ${channelId}'),
      promptTimeout: Schema.number().default(30).description('等待用户发送图片的超时时间 (秒)'),
      saveFailFallback: Schema.boolean().default(true).description('匹配关键词失败时是否保存到临时目录（关闭则直接取消保存）'),
    }).description('存图功能'),
    Schema.object({
      userLimits: Schema.array(Schema.object({
        userId: Schema.string().required().description('用户ID'),
        sizeLimit: Schema.number().min(0).step(0.1).required().description('上传尺寸限制(MB)'),
      })).role('table')
        .description('用户上传限制列表 (MB)。必须包含 userId 为 "default" 的项作为默认限制。设置为 0 或非法值代表禁止上传。')
        .default([{ userId: 'default', sizeLimit: 0 }]),
      groupLimits: Schema.array(Schema.object({
        guildId: Schema.string().required().description('群组ID'),
        sizeLimit: Schema.number().min(0).step(0.1).required().description('上传尺寸限制(MB)'),
      })).role('table')
        .description('群组上传限制列表 (MB)。可包含 guildId 为 "default" 的项作为默认限制。')
        .default([{ guildId: 'default', sizeLimit: 0 }]),
    }).description('权限设置'),
    Schema.object({
      debugMode: Schema.boolean().default(false).description('启用调试日志模式').experimental(),
    }).description('调试模式'),

  ]);


export function apply(ctx: Context, config: Config) {
  config = config || {} as Config

  function loginfo(...args: any[]) {
    if (config.debugMode) {
      (ctx.logger.info as (...args: any[]) => void)(...args);
    }
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
    .usage(`存图方式：
1. 直接存图：${config.saveCommandName} 关键词 [图片]
2. 交互式：发送 ${config.saveCommandName} 后按提示操作
3. 引用存图：回复图片消息并发送 ${config.saveCommandName} [关键词]

关于“关键词”：
关键词即文件夹名称或其别名。系统自动匹配文件夹，文件夹名格式为“主名-别名1-别名2”。
例如文件夹名为“猫图-mt”，则发送“猫图”或“mt”均可匹配到该文件夹并存入图片。若关键词不存在，则根据配置创建新文件夹或存入临时目录。`)
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
      let allImages = []
      for (const 图片Item of 图片) {
        const elements = h.parse(图片Item)
        const images = elements.filter(el => ['img', 'mface', 'image', 'video'].includes(el.type))
        allImages.push(...images)
      }

      // 如果没有图片(参数或引用)，尝试交互式获取
      if (allImages.length === 0) {
        await session.send('请发送图片或视频')
        const promptResult = await session.prompt(config.promptTimeout * 1000)
        if (!promptResult) {
          return '未收到图片或视频'
        }
        const elements = h.parse(promptResult)
        const images = elements.filter(el => ['img', 'mface', 'image', 'video'].includes(el.type))
        allImages.push(...images)
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
          const imageFolders = await fs.readdir(config.imagePath, { withFileTypes: true })
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
    .usage('查看当前所有可用的图库关键词及别名列表。')
    .action(async ({ session }) => {
      try {
        const folders = await fs.readdir(config.imagePath, { withFileTypes: true })
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

  async function processImageRequest(session: Session, input: string) {
    if (!input) return false

    try {
      const folders = await fs.readdir(config.imagePath, { withFileTypes: true })

      // 寻找所有可能的匹配（input以别名开头）
      const possibleMatches = []

      for (const folder of folders) {
        if (!folder.isDirectory()) continue

        const folderName = folder.name
        const aliases = folderName.split('-')

        for (const alias of aliases) {
          if (input.startsWith(alias)) {
            const suffix = input.slice(alias.length).trim()
            possibleMatches.push({
              folderName,
              alias,
              suffix,
              aliasLength: alias.length
            })
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
    .usage(`发送图片。使用 "${config.listCommandName}" 查看所有关键词\n用法：${config.sendCommandName} <关键词> [数量]\n示例：${config.sendCommandName} 猫图 5`)
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
    if (!input) return next()

    // loginfo('收到消息:', { ... })

    await processImageRequest(session, input)
    return next()
  }, true)
}
