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
  debugMode: boolean
  saveCommandName: string
  admins: { userId: string; sizeLimit: number }[]
  allowNormalUserUpload: boolean
  normalUserSizeLimit: number
}

export const Config: Schema<Config> =
  Schema.intersect([
    Schema.object({
      saveCommandName: Schema.string().default('存图').description('存图指令名称'),
      tempPath: Schema.string().required().description('临时存储路径').role('textarea', { rows: [2, 4] }),
      promptTimeout: Schema.number().default(30).description('等待用户发送图片的超时时间 (秒)'),
    }).description('存图功能'),
    Schema.object({
      imagePath: Schema.string().required().description('图片库路径').role('textarea', { rows: [2, 4] }),
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
      allowNormalUserUpload: Schema.boolean().default(true).description('是否允许普通用户上传操作（关闭后仅允许列表中用户上传）'),
      normalUserSizeLimit: Schema.number().default(10).description('普通用户的上传尺寸限制（单位为MB）'),
    }).description('权限设置'),
  ]);


export function apply(ctx: Context, config: Config) {

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
  ctx.command(`${config.saveCommandName} [角色名称] [...图片]`, { captureQuote: false })
    .userFields(['id', 'name', 'authority'])
    .action(async ({ session }, 角色名称, ...图片) => {
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

      // 如果没有图片参数且没有引用消息中的图片，则交互式获取
      if (图片.length === 0) {
        await session.send('请发送图片或视频')
        const promptResult = await session.prompt(config.promptTimeout * 1000)
        if (!promptResult) {
          return '未收到图片或视频'
        }
        图片 = [promptResult]
      }

      // 解析所有图片参数
      let allImages = []
      for (const 图片Item of 图片) {
        const elements = h.parse(图片Item)
        const images = elements.filter(el => ['img', 'mface', 'image', 'video'].includes(el.type))
        allImages.push(...images)
      }

      if (allImages.length === 0) {
        return '请发送有效的图片或视频'
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

        // 如果指定了角色名称，则查找对应的文件夹
        if (角色名称) {
          const matchedFolder = await findCharacterFolder(角色名称)
          if (matchedFolder) {
            folderName = matchedFolder
            targetPath = join(config.tempPath, folderName)
            loginfo('使用匹配的角色文件夹:', folderName)
          } else {
            return `未找到角色"${角色名称}"对应的文件夹，请检查角色名称或别名是否正确，或该人物尚未收录，欢迎催更`
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

        const resultMessage = 角色名称
          ? `已保存 ${savedCount} 个文件到"${角色名称}"文件夹`
          : `已保存 ${savedCount} 个文件到临时文件夹`

        return resultMessage
      } catch (error) {
        return `保存失败: ${error.message}`
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
      const matchedFolders = []

      // 收集所有匹配的文件夹
      for (const folder of folders) {
        if (!folder.isDirectory()) continue

        const folderName = folder.name
        const aliases = folderName.split('-')

        if (aliases.includes(input)) {
          matchedFolders.push(folderName)
        }
      }

      if (matchedFolders.length === 0) {
        return next()
      }

      loginfo('匹配到的文件夹:', matchedFolders)

      // 检测别名重名并输出警告
      if (matchedFolders.length > 1) {
        ctx.logger.warn(`检测到别名重名: 输入"${input}"匹配到${matchedFolders.length}个文件夹: ${matchedFolders.join(', ')}`)
      }

      // 随机选择一个匹配的文件夹
      const selectedFolder = matchedFolders[Math.floor(Math.random() * matchedFolders.length)]
      loginfo('随机选择文件夹:', selectedFolder)

      const folderPath = join(config.imagePath, selectedFolder)
      const files = await fs.readdir(folderPath)
      const mediaFiles = files.filter(file =>
        /\.(jpe?g|png|gif|webp|mp4|mov|avi|bmp|tiff?)$/i.test(file)
      )
      if (mediaFiles.length === 0) {
        return '该文件夹暂无图片或视频'
      }

      // 从选定的文件夹中随机选择一个文件
      const randomFile = mediaFiles[Math.floor(Math.random() * mediaFiles.length)]
      const filePath = join(folderPath, randomFile)

      loginfo('随机选择文件:', randomFile)

      const isVideo = /\.(mp4|mov|avi)$/i.test(randomFile)
      const element = isVideo
        ? h.video(filePath)
        : h.image(filePath)

      await session.send(element)
      return next()
    } catch (error) {
      loginfo('发图失败:', error)
    }

    return next()
  }, true)
}
