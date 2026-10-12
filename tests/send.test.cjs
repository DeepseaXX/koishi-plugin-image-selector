const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { test } = require('node:test')
const { h, App } = require('koishi')
const httpPlugin = require('@koishijs/plugin-http')
const { apply } = require('../lib/index.js')

test('send action outputs file:// url and resolves with http.file', async (t) => {
  const parent = path.resolve(os.tmpdir())
  const directory = await fs.mkdtemp(path.join(parent, 'image-selector-send-test-'))
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true })
  })

  const imagePath = path.join(directory, 'images')
  const catFolder = path.join(imagePath, '猫咪-猫图')
  await fs.mkdir(catFolder, { recursive: true })

  // Write a dummy image and video
  const testImagePath = path.join(catFolder, 'test1.jpg')
  const testVideoPath = path.join(catFolder, 'test2.mp4')
  await fs.writeFile(testImagePath, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]))
  await fs.writeFile(testVideoPath, Buffer.from('dummy video content'))

  const app = new App()
  app.plugin(httpPlugin.default || httpPlugin)
  await app.start()
  t.after(async () => {
    await app.stop()
  })

  const actions = new Map()
  let middlewareFn = null

  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    middleware(fn) { middlewareFn = fn },
    setTimeout(callback, delay) {
      const timer = setTimeout(callback, delay)
      return () => clearTimeout(timer)
    },
    http: app.http,
    command(definition) {
      return {
        usage() { return this },
        userFields() { return this },
        action(callback) { actions.set(definition.split(' ')[0], callback); return this },
      }
    },
  }

  apply(ctx, {
    imagePath,
    tempPath: path.join(directory, 'temp'),
    filenameTemplate: '${index}${ext}',
    saveCommandName: '存图',
    sendCommandName: '发图',
    listCommandName: '图库列表',
    refreshCommandName: '刷新图库',
    createCommandName: '创建关键词',
    addAliasCommandName: '创建别名',
    promptTimeout: 1,
    saveFailFallback: true,
    userLimits: [{ userId: 'default', sizeLimit: 1 }],
    groupLimits: [],
    createLimits: [],
    maxout: 5,
    matchMode: 'fuzzy',
    debugMode: false,
  })

  // Test 1: 发图 指令
  const sent = []
  const session = {
    userId: 'u1',
    username: '测试',
    channelId: 'c1',
    guildId: 'g1',
    async send(element) {
      sent.push(element)
    },
    async execute() {},
  }

  const sendAction = actions.get('发图')
  assert.ok(sendAction, '发图 指令应该已注册')

  await sendAction({ session }, '猫图 1')
  assert.equal(sent.length, 1, '应该发送了一张图或视频')

  const element = sent[0]
  assert.ok(element.attrs.src.startsWith('file://'), `URL 必须以 file:// 开头，实际为: ${element.attrs.src}`)

  // Verify that Koishi's http.file can load this file url directly (which TG and Discord adapters rely on)
  const loaded = await app.http.file(element.attrs.src)
  assert.ok(loaded, 'app.http.file 应该成功读取到文件')
  assert.ok(loaded.data, '应该包含二进制数据')
  assert.ok(loaded.data.byteLength > 0, '数据长度应大于 0')

  // Test 2: 关键词中间件触发
  sent.length = 0
  const sessionMsg = {
    ...session,
    stripped: { content: '猫咪' },
  }

  assert.ok(middlewareFn, '发图中间件应该已注册')
  await middlewareFn(sessionMsg, () => {})

  assert.equal(sent.length, 1, '中间件关键词应该成功触发并发送')
  const msgElement = sent[0]
  assert.ok(msgElement.attrs.src.startsWith('file://'), `中间件发图 URL 必须以 file:// 开头，实际为: ${msgElement.attrs.src}`)

  const loadedMsg = await app.http.file(msgElement.attrs.src)
  assert.ok(loadedMsg, 'app.http.file 应该成功读取中间件发图的文件')
  assert.ok(loadedMsg.data.byteLength > 0, '数据长度应大于 0')
})
