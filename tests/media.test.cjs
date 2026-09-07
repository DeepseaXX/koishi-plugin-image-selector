const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const { h } = require('koishi')

// Load the actual TypeScript module in memory; Yakumo may bundle it into lib/index.js.
const sourcePath = path.resolve(__dirname, '../src/media.ts')
const compiled = new Module(sourcePath, module)
compiled.filename = sourcePath
compiled.paths = Module._nodeModulePaths(path.dirname(sourcePath))
compiled._compile(transformSync(fs.readFileSync(sourcePath, 'utf8'), {
  loader: 'ts',
  format: 'cjs',
  target: 'node18',
  sourcefile: sourcePath,
}).code, sourcePath)
const { createMediaCollector } = compiled.exports

const url = name => `https://example.test/${name}`
const picture = name => h.image(url(name))
const forward = id => h('forward', { id })
const sources = result => result.media.map(element => element.attrs.src)
const collector = (bot = {}, options = {}) => createMediaCollector({ bot, channelId: 'group-123' }, options)

test('an exhausted node budget also prevents fetching the full quote', async () => {
  let reads = 0
  const instance = collector({ async getMessage() { reads++; return { elements: [picture('excluded.png')] } } }, { maxNodes: 1 })
  await instance.collect(h.text('summary'))
  assert.equal(await instance.readQuote('excluded'), undefined)
  assert.equal(reads, 0)
  assert.match(instance.warnings.join(' '), /1 个节点/)
})

test('preserves ordinary image/video order and independent repeated images', async () => {
  const result = await collector().collect([
    picture('a.png'),
    h('video', { src: url('b.mp4') }),
    picture('a.png'),
    { type: 'image', data: { url: url('c.png'), file: 'opaque-image-id' } },
  ])
  assert.deepEqual(sources(result), ['a.png', 'b.mp4', 'a.png', 'c.png'].map(url))
  assert.deepEqual(result.media.map(element => element.type), ['img', 'video', 'img', 'img'])
  assert.equal(result.hasForward, false)
  assert.deepEqual(result.warnings, [])
})

test('expands four nested records across actual OneBot response envelopes', async () => {
  const calls = []
  const payloads = {
    outer: [{ sender: { user_id: 1 }, content: [
      { type: 'image', data: { url: url('outer.png') } },
      { type: 'forward', data: { id: 'second' } },
      { type: 'video', data: { url: url('after.mp4') } },
    ] }],
    second: { message: [{ type: 'node', data: { user_id: 2, nickname: '第二层', content: [
      { type: 'image', data: { url: url('second.png') } },
      { type: 'forward', data: { id: 'third' } },
    ] } }] },
    third: { data: { messages: [{ sender: { user_id: 3 }, message: [
      { type: 'forward', data: { id: 'fourth' } },
    ] }] } },
    fourth: { messages: [{ sender: { user_id: 4 }, content: [
      { type: 'image', data: { url: url('deepest.png') } },
    ] }] },
  }
  const result = await collector({ internal: { async getForwardMsg(id) {
    calls.push(id)
    assert.ok(Object.hasOwn(payloads, id), `unexpected forward id ${id}`)
    return payloads[id]
  } } }).collect(forward('outer'))
  assert.deepEqual(calls, ['outer', 'second', 'third', 'fourth'])
  assert.deepEqual(sources(result), ['outer.png', 'second.png', 'deepest.png', 'after.mp4'].map(url))
  assert.equal(result.hasForward, true)
  assert.deepEqual(result.warnings, [])
})

test('accepts a raw data.message node envelope', async () => {
  const result = await collector({ internal: { async getForwardMsg() {
    return { status: 'ok', data: { message: [{ type: 'node', data: {
      nickname: '发送者', content: [{ type: 'image', data: { file: url('wrapped.png') } }],
    } }] } }
  } } }).collect(forward('wrapped'))
  assert.deepEqual(sources(result), [url('wrapped.png')])
  assert.deepEqual(result.warnings, [])
})

test('parses nested CQ node contents and CQ attribute entities', async () => {
  const calls = []
  const result = await collector({ internal: { async getForwardMsg(id) {
    calls.push(id)
    if (id === 'cq-root') return [{ content:
      '[CQ:node,user_id=1,nickname=发送者,content=&#91;CQ:forward&#44;id=cq-inner&#93;]' }]
    assert.equal(id, 'cq-inner')
    return [{ content: '[CQ:image,url=https://example.test/a&#91;1&#93;.png?x=1&amp;y=2&#44;3]' }]
  } } }).collect(forward('cq-root'))
  assert.deepEqual(calls, ['cq-root', 'cq-inner'])
  assert.deepEqual(sources(result), ['https://example.test/a[1].png?x=1&y=2,3'])
  assert.deepEqual(result.warnings, [])
})

test('traverses real Satori message/figure children and inline raw nodes', async () => {
  const result = await collector().collect(h('message', { forward: true }, [
    h('message', {}, [picture('outer.png')]),
    h('figure', {}, [h('message', {}, [picture('figure.png'), h('video', { src: url('figure.mp4') })])]),
    h('message', {}, [h('forward', {}, [h('message', {}, [picture('inline.png')])])]),
  ]))
  const raw = await collector().collect({ type: 'node', data: { content: [
    { type: 'node', data: { message: [picture('node.png')] } },
  ] } })
  assert.deepEqual(sources(result), ['outer.png', 'figure.png', 'figure.mp4', 'inline.png'].map(url))
  assert.deepEqual(sources(raw), [url('node.png')])
  assert.equal(result.hasForward, true)
  assert.deepEqual(result.warnings, [])
})

test('prefers the dedicated forward API even when getMessage would return a self reference', async () => {
  let ordinaryReads = 0
  let forwardReads = 0
  const result = await collector({
    async getMessage() { ordinaryReads++; return { elements: [forward('same')] } },
    internal: { async getForwardMsg(id) {
      assert.equal(id, 'same')
      forwardReads++
      return [{ content: [picture('dedicated.png')] }]
    } },
  }).collect(forward('same'))
  assert.equal(ordinaryReads, 0)
  assert.equal(forwardReads, 1)
  assert.deepEqual(sources(result), [url('dedicated.png')])
})

test('reads the official session.onebot alias with its method binding intact', async () => {
  const onebot = { label: 'bound-api', async getForwardMsg(id) {
    assert.equal(this.label, 'bound-api')
    assert.equal(id, 'alias')
    return [{ content: [picture('alias.png')] }]
  } }
  const result = await createMediaCollector({ bot: {}, channelId: 'group-123', onebot }).collect(forward('alias'))
  assert.deepEqual(sources(result), [url('alias.png')])
  assert.deepEqual(result.warnings, [])
})

test('supports the existing snake_case internal API', async () => {
  const result = await collector({ internal: { async get_forward_msg(params) {
    assert.equal(params.id, 'snake')
    return { data: { messages: [{ content: [picture('snake.png')] }] } }
  } } }).collect(forward('snake'))
  assert.deepEqual(sources(result), [url('snake.png')])
})

test('does not fetch or save a repeated record twice while preserving repeated media outside it', async () => {
  const calls = []
  const instance = collector({ internal: { async getForwardMsg(id) {
    calls.push(id)
    return [{ content: [picture('shared.png')] }]
  } } })
  const first = await instance.collect([
    forward('shared'), picture('separate.png'), forward('shared'), picture('separate.png'),
  ])
  const second = await instance.collect(forward('shared'))
  assert.deepEqual(calls, ['shared'])
  assert.deepEqual(sources(first), ['shared.png', 'separate.png', 'separate.png'].map(url))
  assert.deepEqual(second.media, [])
  assert.deepEqual(first.warnings, [])
})

test('already expanded record content is used once without an extra request', async () => {
  let reads = 0
  const result = await collector({ internal: { async getForwardMsg() { reads++; return [] } } }).collect([
    h('forward', { id: 'inline-id' }, [h('message', {}, [picture('ready.png')])]),
    forward('inline-id'),
  ])
  assert.equal(reads, 0)
  assert.deepEqual(sources(result), [url('ready.png')])
})

test('cycles stop at their reference and sibling media still survives', async () => {
  const calls = []
  const result = await collector({ internal: { async getForwardMsg(id) {
    calls.push(id)
    return id === 'a'
      ? [{ content: [picture('a.png'), forward('b'), picture('after-a.png')] }]
      : [{ content: [forward('a'), picture('b.png')] }]
  } } }).collect(forward('a'))
  assert.deepEqual(calls, ['a', 'b'])
  assert.deepEqual(sources(result), ['a.png', 'b.png', 'after-a.png'].map(url))
  assert.match(result.warnings.join(' '), /循环|未展开/)
})

test('a failed nested read preserves sibling media and caches the failed request', async () => {
  let failedReads = 0
  let ordinaryReads = 0
  const result = await collector({
    async getMessage() { ordinaryReads++; return { elements: [picture('wrong.png')] } },
    internal: { async getForwardMsg(id) {
      if (id === 'bad') { failedReads++; throw new Error('fixture read failure') }
      return [{ content: [picture('before.png'), forward('bad'), forward('bad'), picture('after.png')] }]
    } },
  }).collect(forward('outer'))
  assert.deepEqual(sources(result), ['before.png', 'after.png'].map(url))
  assert.equal(failedReads, 1)
  assert.equal(ordinaryReads, 0)
  assert.match(result.warnings.join(' '), /读取失败/)
})

test('a hung record times out and later media is still collected', async () => {
  const result = await collector({ internal: { getForwardMsg() { return new Promise(() => {}) } } }, {
    timeoutMs: 10,
  }).collect([forward('hung'), picture('after-timeout.png')])
  assert.deepEqual(sources(result), [url('after-timeout.png')])
  assert.match(result.warnings.join(' '), /超时/)
})

test('the depth limit prevents deeper requests but preserves outer siblings', async () => {
  const calls = []
  const result = await collector({ internal: { async getForwardMsg(id) {
    calls.push(id)
    assert.equal(id, 'outer', 'the excluded inner record must not be requested')
    return [{ content: [picture('outer.png'), forward('too-deep'), picture('after.png')] }]
  } } }, { maxDepth: 1 }).collect(forward('outer'))
  assert.deepEqual(calls, ['outer'])
  assert.deepEqual(sources(result), ['outer.png', 'after.png'].map(url))
  assert.match(result.warnings.join(' '), /1 层/)
})

test('the node limit stops before an excluded network read', async () => {
  let reads = 0
  const result = await collector({ internal: { async getForwardMsg() { reads++; return [] } } }, {
    maxNodes: 2,
  }).collect([picture('first.png'), picture('second.png'), forward('excluded')])
  assert.equal(reads, 0)
  assert.deepEqual(sources(result), ['first.png', 'second.png'].map(url))
  assert.match(result.warnings.join(' '), /2 个节点/)
})

test('unsupported folded records produce a warning instead of silently appearing empty', async () => {
  const result = await collector().collect(forward('unsupported'))
  assert.equal(result.hasForward, true)
  assert.deepEqual(result.media, [])
  assert.match(result.warnings.join(' '), /适配器不支持/)
  const empty = await collector().collect([h.text('这条消息只有文字')])
  assert.equal(empty.hasForward, false)
  assert.deepEqual(empty.warnings, [])
})

test('ordinary quoted message IDs are fetched through getMessage', async () => {
  let reads = 0
  const instance = collector({ async getMessage(channel, id) {
    assert.equal(channel, 'group-123')
    assert.equal(id, 'ordinary-message-id')
    reads++
    return { id, elements: [picture('quote.png')] }
  } })
  const quote = await instance.readQuote('ordinary-message-id')
  const result = await instance.collect(quote)
  await instance.readQuote('ordinary-message-id')
  assert.equal(reads, 1)
  assert.deepEqual(sources(result), [url('quote.png')])
})

test('display text containing CQ code is not interpreted as another record or image', async () => {
  let reads = 0
  const result = await collector({ internal: { async getForwardMsg() { reads++; return [] } } }).collect([
    h.text('[CQ:forward,id=literal]'),
    h.text('[CQ:image,url=https://example.test/literal.png]'),
    picture('real.png'),
  ])
  assert.equal(reads, 0)
  assert.deepEqual(sources(result), [url('real.png')])
  assert.deepEqual(result.warnings, [])
})

test('a record seen again at a shallower depth exposes previously excluded descendants without duplicate media', async () => {
  const calls = []
  const payloads = {
    outer: [{ content: [forward('middle')] }],
    middle: [{ content: [forward('shared')] }],
    shared: [{ content: [picture('shared.png'), picture('shared.png'), forward('deepest')] }],
    deepest: [{ content: [picture('newly-reachable.png')] }],
  }
  const result = await collector({ internal: { async getForwardMsg(id) {
    calls.push(id)
    assert.ok(Object.hasOwn(payloads, id), `unexpected forward id ${id}`)
    return payloads[id]
  } } }, { maxDepth: 3 }).collect([forward('outer'), forward('shared')])
  assert.deepEqual(calls, ['outer', 'middle', 'shared', 'deepest'])
  assert.deepEqual(sources(result), ['shared.png', 'shared.png', 'newly-reachable.png'].map(url))
})

test('string and text-only forward summaries still fetch their full record', async () => {
  const summaries = [
    { type: 'forward', data: { id: 'summary', content: '聊天记录摘要' } },
    { type: 'forward', data: { id: 'summary', content: ['发送者：消息摘要'] } },
    h('forward', { id: 'summary' }, [h.text('发送者：消息摘要')]),
  ]
  for (const input of summaries) {
    let reads = 0
    const result = await collector({ internal: { async getForwardMsg(id) {
      reads++
      assert.equal(id, 'summary')
      return [{ sender: { user_id: 1 }, content: [picture('full-record.png')] }]
    } } }).collect(input)
    assert.equal(reads, 1, 'the displayed summary must not stand in for a full record')
    assert.deepEqual(sources(result), [url('full-record.png')])
    assert.deepEqual(result.warnings, [])
  }
})

test('a standard API that returns only a summary is reported as incomplete', async () => {
  const result = await collector({ async getMessage(channel, id) {
    assert.equal(channel, 'group-123')
    assert.equal(id, 'unexpanded')
    return { id, elements: [h.text('聊天记录摘要')] }
  } }).collect(forward('unexpanded'))
  assert.equal(result.hasForward, true)
  assert.deepEqual(result.media, [])
  assert.match(result.warnings.join(' '), /未展开|读取失败|不支持/)
})

test('processing exactly the allowed number of nodes does not claim truncation', async () => {
  const result = await collector({}, { maxNodes: 2 }).collect([
    picture('first.png'), picture('second.png'),
  ])
  assert.deepEqual(sources(result), ['first.png', 'second.png'].map(url))
  assert.deepEqual(result.warnings, [])
})

test('follows merged-record JSON cards across Koishi elements, raw segments, and nested CQ content', async () => {
  const calls = []
  const payloads = {
    'card-root': [{ content: [
      picture('before-card.png'),
      { type: 'json', data: { data: JSON.stringify({
        app: 'com.tencent.multimsg', meta: { detail: { resid: 'card-middle' } },
      }) } },
      picture('after-card.png'),
    ] }],
    'card-middle': [{ content:
      '[CQ:json,data={"app":"com.tencent.multimsg"&#44;"meta":{"detail":{"resid":"card-deep"}}}]' }],
    'card-deep': [{ content: [picture('deep-card.png')] }],
  }
  const result = await collector({ internal: { async getForwardMsg(id) {
    calls.push(id)
    assert.ok(Object.hasOwn(payloads, id), `unexpected card record id ${id}`)
    return payloads[id]
  } } }).collect(h('onebot:json', { data: JSON.stringify({
    app: 'com.tencent.multimsg', meta: { detail: { resid: 'card-root' } },
  }) }))
  assert.deepEqual(calls, ['card-root', 'card-middle', 'card-deep'])
  assert.deepEqual(sources(result), ['before-card.png', 'deep-card.png', 'after-card.png'].map(url))
  assert.equal(result.hasForward, true)
  assert.deepEqual(result.warnings, [])
})

test('ignores unrelated or malformed cards and warns about a known merged card without its resource ID', async () => {
  let reads = 0
  const result = await collector({ internal: { async getForwardMsg() { reads++; return [] } } }).collect([
    h('json', { data: JSON.stringify({
      app: 'com.tencent.structmsg',
      meta: { detail: { resid: 'not-a-forward', news: [{ text: '[CQ:forward,id=display-only]' }] } },
    }) }, [picture('not-real-card-child.png')]),
    { type: 'json', data: { data: '{broken-json:[CQ:image,url=https://example.test/not-real.png]' } },
    h('onebot:json', { data: JSON.stringify({
      app: 'com.tencent.multimsg',
      meta: { detail: { news: [{ text: '[CQ:image,url=https://example.test/summary-only.png]' }] } },
    }) }),
    picture('real-message.png'),
  ])
  assert.equal(reads, 0)
  assert.deepEqual(sources(result), [url('real-message.png')])
  assert.equal(result.hasForward, true)
  assert.match(result.warnings.join(' '), /记录.*ID|ID.*记录|没有可读取|缺少/)
})
