const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { test } = require('node:test')
const { h } = require('koishi')
// Verify the built entry and the real save action, including filesystem writes.
const { apply } = require('../lib/index.js')

async function setup(t, options = {}) {
  const parent = path.resolve(os.tmpdir())
  const directory = await fs.mkdtemp(path.join(parent, 'image-selector-test-'))
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), parent)
    assert.ok(path.basename(directory).startsWith('image-selector-test-'))
    await fs.rm(directory, { recursive: true, force: true })
  })
  const imagePath = path.join(directory, 'images')
  const target = path.join(imagePath, '猫咪-猫图')
  await fs.mkdir(target, { recursive: true })
  const actions = new Map()
  const downloaded = []
  const ctx = {
    logger: { info() {}, warn() {} },
    middleware() {},
    setTimeout(callback, delay) {
      const timer = setTimeout(callback, delay)
      return () => clearTimeout(timer)
    },
    http: { async file(url) {
      downloaded.push(url)
      return { type: url.endsWith('.mp4') ? 'video/mp4' : 'image/png', data: Buffer.from(url) }
    } },
    command(definition) {
      return {
        usage() { return this },
        userFields() { return this },
        action(callback) { actions.set(definition.split(' ')[0], callback); return this },
      }
    },
  }
  apply(ctx, {
    imagePath, tempPath: path.join(directory, 'temp'),
    filenameTemplate: '${index}${ext}', saveCommandName: '存图', sendCommandName: '发图',
    listCommandName: '图库列表', refreshCommandName: '刷新图库', createCommandName: '创建关键词',
    addAliasCommandName: '创建别名', promptTimeout: 1, saveFailFallback: true,
    userLimits: [{ userId: 'default', sizeLimit: 1 }], groupLimits: [], createLimits: [],
    maxout: 5, matchMode: 'none', debugMode: false,
    ...options,
  })
  const sent = []
  const replies = []
  const readIds = []
  let quoteReads = 0
  const forward = id => h('forward', { id })
  const session = {
    userId: 'u1', username: '测试', channelId: 'c1', guildId: 'g1',
    async send(text) { sent.push(text) },
    async prompt() { assert.ok(replies.length, 'unexpected upload/category prompt'); return replies.shift() },
    bot: {
      async getMessage(channel, id) {
        assert.equal(channel, 'c1')
        assert.equal(id, 'quoted-message')
        quoteReads++
        return { elements: [forward('outer')] }
      },
      internal: { async getForwardMsg(id) {
        readIds.push(id)
        if (id === 'broken') throw new Error('record is unavailable')
        if (id === 'outer') return { messages: [{ content: [
          h.image('https://example.test/outer.png'), forward('middle'), forward('broken'),
          h('video', { src: 'https://example.test/after.mp4' }),
        ] }] }
        if (id === 'middle') return [{ content: '[CQ:forward,id=inner]' }]
        assert.equal(id, 'inner')
        return { data: { message: [{ type: 'node', data: { content: [
          { type: 'image', data: { url: 'https://example.test/inner.png' } },
        ] } }] } }
      } },
    },
  }
  return { session, action: actions.get('存图'), target, sent, replies, readIds, downloaded,
    quoteReads: () => quoteReads }
}

for (const mode of ['quote-elements', 'quote-summary', 'direct', 'interactive', 'no-keyword']) {
  test(`save action writes nested media in order from ${mode} and reports partial reads`, async t => {
    const fixture = await setup(t)
    const { session, replies, action, sent } = fixture
    const content = '<forward id="outer"/>'
    let args = ['猫图']
    if (mode === 'quote-elements') {
      // The serialized summary must not hide complete elements.
      session.quote = { id: 'quoted-message', content: '聊天记录摘要', elements: [h('forward', { id: 'outer' })] }
    } else if (mode === 'quote-summary') {
      session.quote = { id: 'quoted-message', content: '聊天记录摘要' }
    } else if (mode === 'direct') {
      args.push(content)
    } else if (mode === 'no-keyword') {
      args = [content]
      replies.push('猫图')
    } else {
      replies.push(content)
    }
    const result = await action({ session }, ...args)
    assert.equal(result, '已保存 3 个文件到“猫咪-猫图”分类。')
    assert.deepEqual(fixture.readIds, ['outer', 'middle', 'inner', 'broken'])
    assert.equal(fixture.quoteReads(), mode === 'quote-summary' ? 1 : 0)
    const expected = ['outer.png', 'inner.png', 'after.mp4'].map(name => `https://example.test/${name}`)
    assert.deepEqual(fixture.downloaded, expected)
    const files = (await fs.readdir(fixture.target)).sort()
    assert.deepEqual(files, ['1.png', '2.png', '3.mp4'])
    assert.deepEqual(await Promise.all(files.map(name => fs.readFile(path.join(fixture.target, name), 'utf8'))), expected)
    assert.ok(sent.some(text => text.includes('消息未完全读取') && text.includes('3 个媒体文件')))
    assert.equal(replies.length, 0)
  })
}

test('unreadable records report failure without prompting for another upload or writing files', async t => {
  const fixture = await setup(t)
  const result = await fixture.action({ session: fixture.session }, '猫图', '<forward id="broken"/>')
  assert.match(result, /未能完整读取消息/)
  assert.match(result, /读取失败/)
  assert.deepEqual(fixture.downloaded, [])
  assert.deepEqual(await fs.readdir(fixture.target), [])
})

test('existing upload permissions still prevent file downloads and writes', async t => {
  const fixture = await setup(t, { userLimits: [{ userId: 'default', sizeLimit: 0 }] })
  const result = await fixture.action({ session: fixture.session }, '猫图', '<img src="https://example.test/denied.png"/>')
  assert.match(result, /没有存图权限/)
  assert.deepEqual(fixture.downloaded, [])
  assert.deepEqual(await fs.readdir(fixture.target), [])
})
