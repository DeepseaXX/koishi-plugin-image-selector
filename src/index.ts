import { Context, Schema, h } from 'koishi'

import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export const name = 'image-selecter'
export const inject = {
  required: ['http', 'logger']
};

export const usage = `
---

<a target="_blank" href="https://www.npmjs.com/package/koishi-plugin-image-selecter">➤ 食用方法点此获取</a>

---
`;

export interface Config {
  tempPath: string
  imagePath: string
  promptTimeout: number
  filenameTemplate: string
  saveCommandName: string
  listCommandName: string
  admins: { userId: string; sizeLimit: number }[]
  allowNormalUserUpload: boolean
  normalUserSizeLimit: number
  maxout: number
  debugMode: boolean
}

export const Config: Schema<Config> =
  Schema.intersect([
    Schema.object({
      saveCommandName: Schema.string().default('存图').description('存图指令名称'),
      listCommandName: Schema.string().default('图库列表').description('图库列表指令名称'),
      tempPath: Schema.string().required().description('临时存储路径').role('textarea', { rows: [2, 4] }),
      promptTimeout: Schema.number().default(30).description('等待用户发送图片的超时时间 (秒)'),
    }).description('存图功能'),
    Schema.object({
      imagePath: Schema.string().required().description('图片库路径').role('textarea', { rows: [2, 4] }),
      maxout: Schema.number().default(5).description('一次最大输出图片数量'),
      filenameTemplate: Schema.string().role('textarea', { rows: [2, 4] })
        .default("${date}-${time}-${index}-${guildId}-${userId}${ext}").description('文件名模板，支持变量: ${userId}, ${username}, ${timestamp}, ${date}, ${time}, ${index}, ${ext}, ${guildId}, ${channelId}'),
    }).description('发图功能'),
    Schema.object({
      debugMode: Schema.boolean().default(false).description('启用调试日志模式').experimental(),
    }).description('调试模式'),
    Schema.object({
      admins: Schema.array(Schema.object({
        userId: Schema.string().description('用户ID'),
        sizeLimit: Schema.number().description('上传尺寸限制(MB)'),
      })).role('table').description('管理员列表'),
      allowNormalUserUpload: Schema.boolean().default(false).description('是否允许普通用户上传操作（关闭后仅允许列表中用户上传）'),
      normalUserSizeLimit: Schema.number().default(3).description('普通用户的上传尺寸限制（单位为MB）'),
    }).description('权限设置'),
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
      const adminConfig = config.admins?.find(admin => admin.userId === userId)
      let sizeLimitMB = 0

      if (adminConfig) {
        sizeLimitMB = adminConfig.sizeLimit
        loginfo(`用户 ${userId} 是管理员，尺寸限制: ${sizeLimitMB}MB`)
      } else {
        if (!config.allowNormalUserUpload) {
          return '普通用户禁止上传，请联系管理员'
        }
        sizeLimitMB = config.normalUserSizeLimit
        loginfo(`用户 ${userId} 是普通用户，尺寸限制: ${sizeLimitMB}MB`)
      }

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
  ctx.command(config.listCommandName)
    .action(async ({ session }) => {
      try {
        const folders = await fs.readdir(config.imagePath, { withFileTypes: true })
        let messageLines = []

        // 收集并格式化文件夹信息
        let firstExample: { main: string; alias: string; found?: boolean } = { main: '猪图', alias: 'pig' }
        let hasFolders = false

        for (const folder of folders) {
          if (!folder.isDirectory()) continue

          hasFolders = true
          const folderName = folder.name
          const parts = folderName.split('-')
          const mainName = parts[0]
          const aliases = parts.slice(1)

          // 更新示例（使用第一个找到的有效文件夹）
          if (!firstExample.found && aliases.length > 0) {
            firstExample = { main: mainName, alias: aliases[0], found: true }
          } else if (!firstExample.found) {
            firstExample = { main: mainName, alias: mainName, found: true }
          }

          if (aliases.length > 0) {
            messageLines.push(`${mainName} 别名：${aliases.join(', ')}`)
          } else {
            messageLines.push(`${mainName}`)
          }
        }

        if (!hasFolders) {
          return '图库为空'
        }

        const header = `发送指令【${firstExample.main}】或别名【${firstExample.alias}】 随机返回图片`
        return [header, ...messageLines].join('\n')

      } catch (error) {
        return `获取列表失败: ${error.message}`
      }
    })

  // 发图中间件
  ctx.middleware(async (session, next) => {
    const input = session.stripped.content.trim()
    if (!input) return next()

    // loginfo('收到消息:', {
    //   userId: session.userId,
    //   username: session.username,
    //   guildId: session.guildId,
    //   channelId: session.channelId,
    //   content: input
    // })

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
        return next()
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
        const parsed = parseInt(suffix, 10)
        if (!isNaN(parsed) && parsed > 0 && String(parsed) === suffix) {
          count = parsed
        } else {
          // 尝试处理 "5" 这种纯数字或者 " 5"
          // 如果 suffix 不是纯数字（允许负号但不处理），则 count 维持 1
          // 只有当 input = alias + space + number 或 input = alias + number 时才尝试。
          // 但上面的 logic 是 trim() 过的。
          // 如果 suffix 是 "abc"，parseInt("abc") -> NaN.
          // 如果 suffix 是 "100abc", parseInt -> 100.
          // 需求说 "有任何非整数...只发送一张"。所以 "100abc" 应该发送 1 张。
          // 所以我们应该严格检查 suffix 是否为数字。
          if (/^\d+$/.test(suffix)) {
            count = Math.min(parseInt(suffix, 10), config.maxout)
          } else {
            count = 1
          }
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
        return '该文件夹暂无图片或视频'
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
        // 稍微延迟一下？不，session.send是异步的但这里await了，所以是顺序发送。
      }

      return next()
    } catch (error) {
      loginfo('发图失败:', error)
    }

    return next()
  }, true)
}
