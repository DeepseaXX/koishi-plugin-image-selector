import { h, Session } from 'koishi'

export interface MediaOptions {
    maxDepth?: number
    maxNodes?: number
    timeoutMs?: number
    log?: (...args: any[]) => void
    // 由 Koishi context 管理计时器，插件卸载时一起清理。
    setTimeout?: (callback: () => void, delay: number) => () => void
}

export interface MediaResult {
    media: h[]
    warnings: string[]
    hasForward: boolean
}

const mediaTypes = new Set(['img', 'image', 'mface', 'video'])

function hasContent(value: unknown): boolean {
    return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== ''
}

function bodyOf(value: any): unknown {
    return [value?.elements, value?.children, value?.content, value?.message, value?.messages].find(hasContent)
}

function decodeCQ(value: string): string {
    return value.replace(/&#91;/g, '[').replace(/&#93;/g, ']').replace(/&#44;/g, ',').replace(/&amp;/g, '&')
}

// CQ 只在原始消息字符串中解析；Koishi text 元素中的内容始终按文字处理。
function parseContent(content: string): unknown[] {
    const pattern = /\[CQ:(\w+)((?:,\w+=[^,\]]*)*)\]/g
    const result: unknown[] = []
    let offset = 0
    for (const match of content.matchAll(pattern)) {
        if (match.index > offset) result.push(...h.parse(content.slice(offset, match.index)))
        const data: Record<string, string> = {}
        for (const attr of match[2].matchAll(/,(\w+)=([^,]*)/g)) data[attr[1]] = decodeCQ(attr[2])
        result.push({ type: match[1], data })
        offset = match.index + match[0].length
    }
    if (offset < content.length) result.push(...h.parse(content.slice(offset)))
    return result
}

function forwardId(attrs: any): string | undefined {
    const id = [attrs.id, attrs.messageId, attrs.message_id, attrs.resid, attrs.m_resid, attrs.mResid]
        .find(value => (typeof value === 'string' && value.length > 0) || typeof value === 'number')
    return id === undefined ? undefined : String(id)
}

function forwardCard(value: any): { id?: string } | undefined {
    if (value?.type !== 'json' && value?.type !== 'onebot:json') return undefined
    const source = (value.attrs ?? value.data)?.data
    try {
        const card = typeof source === 'string' ? JSON.parse(source) : source
        if (card?.app !== 'com.tencent.multimsg') return undefined
        return { id: forwardId({ resid: card.meta?.detail?.resid }) }
    } catch {
        return undefined
    }
}

function isExpandedBody(value: any): boolean {
    if (typeof value === 'string') return isExpandedBody(parseContent(value))
    if (Array.isArray(value)) return value.some(isExpandedBody)
    if (!value || typeof value !== 'object') return false
    if (!value.type) return bodyOf(value) !== undefined
    if (forwardCard(value)) return true
    return mediaTypes.has(value.type) || ['message', 'node', 'forward', 'figure'].includes(value.type)
}

export function createMediaCollector(session: Pick<Session, 'bot' | 'channelId'> & { onebot?: unknown }, options: MediaOptions = {}) {
    const maxDepth = options.maxDepth ?? 32
    const maxNodes = options.maxNodes ?? 10000
    const timeoutMs = options.timeoutMs ?? 15000
    const schedule = options.setTimeout ?? ((callback, delay) => {
        const timer = setTimeout(callback, delay)
        return () => clearTimeout(timer)
    })
    const requests = new Map<string, Promise<unknown>>()
    const expanded = new Map<string, number>()
    const recordBodies = new Map<string, unknown>()
    const collectedPositions = new Set<string>()
    const warnings = new Set<string>()
    let visitedNodes = 0
    let hasForward = false

    async function request(key: string, action: () => Promise<unknown>): Promise<unknown> {
        if (!requests.has(key)) {
            requests.set(key, new Promise((resolve, reject) => {
                const cancel = schedule(() => reject(new Error('读取超时')), timeoutMs)
                Promise.resolve().then(action).then(resolve, reject).finally(cancel)
            }))
        }
        return requests.get(key)
    }

    async function readForward(id: string): Promise<unknown> {
        const bot = session.bot
        // OneBot 也可能在 session.onebot 上暴露内部 API。
        const candidates = [bot?.internal, session.onebot as any, (bot as any)?.onebot]
        const internal = candidates.find(api => typeof api?.getForwardMsg === 'function' || typeof api?.get_forward_msg === 'function')
        if (internal) {
            // 合并资源 ID 与普通消息 ID 不同，专用接口失败也不能把它当作普通消息 ID。
            const payload: any = await request(`forward:${id}`, () => typeof internal.getForwardMsg === 'function'
                ? internal.getForwardMsg(id)
                : internal.get_forward_msg({ id, message_id: id }))
            const data = payload?.data ?? payload
            if (Array.isArray(data)) return data
            if (Array.isArray(data?.messages)) return data.messages
            if (Array.isArray(data?.message)) return data.message
            const body = bodyOf(data)
            if (body !== undefined) return body
            throw new Error('适配器未返回可读取的合并记录')
        }
        if (typeof bot?.getMessage === 'function') {
            const payload = await request(`message:${id}`, () => bot.getMessage(session.channelId, id))
            const body = bodyOf(payload)
            if (isExpandedBody(body)) return body
        }
        throw new Error('适配器未提供可读取的合并记录')
    }

    async function collect(input: unknown): Promise<MediaResult> {
        const media: h[] = []
        type Frame = { value: any; depth: number; path: Set<string>; index?: number; origin?: string; location: string }
        const stack: Frame[] = [{ value: input, depth: 0, path: new Set(), location: '' }]
        // 显式栈避免大量已展开容器导致 JavaScript 调用栈溢出。
        while (stack.length) {
            const frame = stack.pop()!
            const { value, depth, path, origin, location } = frame
            if (!hasContent(value)) continue
            if (Array.isArray(value)) {
                const index = frame.index ?? 0
                if (index < value.length) {
                    stack.push({ ...frame, index: index + 1 })
                    stack.push({ value: value[index], depth, path, origin, location: `${location}/${index}` })
                }
                continue
            }
            if (visitedNodes >= maxNodes) {
                warnings.add(`达到单次 ${maxNodes} 个节点的处理上限`)
                break
            }
            visitedNodes++
            if (typeof value === 'string') {
                stack.push({ value: parseContent(value), depth, path, origin, location: `${location}/parsed` })
                continue
            }
            if (typeof value !== 'object') continue
            const card = forwardCard(value)
            const attrs = card ?? value.attrs ?? value.data ?? {}
            const type = card ? 'forward' : value.type
            if (mediaTypes.has(type)) {
                const src = attrs.src || attrs.url || (/^(https?:|file:|data:)/i.test(attrs.file || '') ? attrs.file : undefined)
                if (src) {
                    const position = origin ? JSON.stringify([origin, location]) : undefined
                    if (!position || !collectedPositions.has(position)) {
                        media.push(h(type === 'image' ? 'img' : type, { ...attrs, src }))
                        if (position) collectedPositions.add(position)
                    }
                }
                else warnings.add('部分媒体没有可下载的地址')
                continue
            }

            const isForward = type === 'forward' || type === 'figure'
                || (type === 'message' && (attrs.forward === true || attrs.forward === 'true'))
            if (isForward) {
                hasForward = true
                const id = forwardId(attrs)
                if (id && path.has(id)) {
                    warnings.add('跳过了循环引用或未展开的合并记录')
                    continue
                }
                // 更浅的位置可能读到此前因层数限制被跳过的子记录，需允许重新遍历。
                if (id && expanded.has(id) && expanded.get(id)! <= depth) continue
                if (depth >= maxDepth) {
                    warnings.add(`达到最多 ${maxDepth} 层合并记录的处理上限`)
                    continue
                }
                const nextPath = new Set(path)
                if (id) nextPath.add(id)
                let body = recordBodies.get(id) ?? (card ? undefined : bodyOf(value) ?? bodyOf(attrs))
                // forward 下只有摘要文字/卡片时仍需读取 ID；message/figure 可包含纯文字完整内容。
                if (type === 'forward' && id && !recordBodies.has(id) && !isExpandedBody(body)) body = undefined
                if (!hasContent(body) && id) {
                    try {
                        body = await readForward(id)
                    } catch (error) {
                        options.log?.(`读取合并记录 ${id} 失败：`, error)
                        warnings.add('部分合并记录读取失败、超时或适配器不支持读取')
                        continue
                    }
                }
                if (body === undefined) {
                    warnings.add('部分合并记录没有可读取的内容或记录 ID')
                    continue
                }
                if (id) {
                    expanded.set(id, depth)
                    recordBodies.set(id, body)
                }
                stack.push({ value: body, depth: depth + 1, path: nextPath,
                    origin: id ?? origin, location: id ? '' : `${location}/body` })
                continue
            }

            // 原始 node 的 data.content 与标准元素的 children 都保留；不解析文字及其他卡片的展示内容。
            if (['text', 'json', 'onebot:json', 'xml', 'quote', 'face'].includes(type)) continue
            const body = bodyOf(value) ?? (type === 'node' ? bodyOf(attrs) : undefined)
            if (body !== undefined) stack.push({ value: body, depth, path, origin, location: `${location}/body` })
            else if (!type && value.data) stack.push({ value: value.data, depth, path, origin, location: `${location}/data` })
        }
        return { media, warnings: [...warnings], hasForward }
    }

    async function readQuote(id: string): Promise<unknown> {
        if (typeof session.bot?.getMessage !== 'function') return undefined
        if (visitedNodes >= maxNodes) {
            warnings.add(`达到单次 ${maxNodes} 个节点的处理上限`)
            return undefined
        }
        try {
            return await request(`message:${id}`, () => session.bot.getMessage(session.channelId, id))
        } catch (error) {
            options.log?.('拉取完整引用消息失败：', error)
            warnings.add('完整引用消息读取失败或超时')
        }
    }

    return { collect, readQuote, get warnings() { return [...warnings] } }
}
