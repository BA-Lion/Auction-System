import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve, extname, sep } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import { Auction, amount, check, iso } from './auction.js'

const frontend = fileURLToPath(new URL('../frontend/', import.meta.url))
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg' }
const publicUser = ({ user_id, username, nickname }) => ({ user_id, username, nickname })
const success = (body, status = 200) => ({ status, body })
const sessionId = req => (req.headers.cookie || '').match(/(?:^|;\s*)auction_session=([a-f0-9-]+)/)?.[1]
const need = item => { check(item, 404, 'NOT_FOUND', '未找到此记录'); return item }

async function jsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    check(size <= 32768, 413, 'INVALID_ARGUMENT', '请求过大')
    chunks.push(chunk)
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    if (data && typeof data === 'object' && !Array.isArray(data)) return data
  } catch { /* Report a public validation error below. */ }
  check(false, 400, 'INVALID_ARGUMENT', '请求必须是 JSON 对象')
}

export function createDemo({ filename = resolve('.cache/auction-demo.json'), seed = true, clock = Date.now } = {}) {
  const auction = new Auction(filename, seed)
  const sessions = new Map()
  const pages = new Map()
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 4096 })
  const sessionUser = req => auction.user(sessions.get(sessionId(req)))
  const send = (ws, message) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)) }
  function broadcast(round, receipt) {
    for (const ws of sockets.clients) {
      if (ws.round !== round.state.round_id) continue
      if (receipt) {
        if (sessions.get(ws.sid) === receipt.user_id) send(ws, { type: 'bid.receipt', record: receipt })
      } else send(ws, { type: 'round.updated', state: round.state, server_time: iso(clock()) })
    }
  }

  function list(items, search, scope) {
    const cursor = search.get('cursor')
    const page = cursor ? pages.get(cursor) : null
    if (cursor) check(page?.scope === scope && page.until > clock(), 410, 'CURSOR_EXPIRED', '列表已过期，请刷新')
    const limit = page?.limit ?? Number(search.get('limit') || 20)
    check(Number.isInteger(limit) && limit > 0 && limit <= 100, 400, 'INVALID_ARGUMENT', '分页大小无效')
    const rows = page?.rows ?? items
    let next_cursor = null
    if (rows.length > limit) {
      next_cursor = randomUUID()
      pages.set(next_cursor, { scope, limit, rows: structuredClone(rows.slice(limit)), until: clock() + 300000 })
    }
    return success({ items: rows.slice(0, limit), next_cursor })
  }
  function card(round) {
    const { round_id, status, start_price, current_price, starts_at, ends_at } = round.state
    const { lot_id, title, images, category_code } = auction.lot(round.lot_id)
    return { round_id, status, start_price, current_price, starts_at, ends_at, lot_id, title, images, category_code }
  }
  function sorted(rounds) {
    return rounds.map(card).sort((a, b) => b.starts_at.localeCompare(a.starts_at) || b.round_id.localeCompare(a.round_id))
  }
  function keyed(req, uid, path, input, action) {
    const key = req.headers['idempotency-key']
    check(typeof key === 'string' && key.length > 0 && key.length <= 128, 400, 'INVALID_ARGUMENT', '缺少有效业务键')
    const token = JSON.stringify([uid, path, key])
    const signature = JSON.stringify(input, Object.keys(input).sort())
    const previous = auction.data.keys[token]
    if (previous) {
      check(previous.signature === signature, 409, 'IDEMPOTENCY_CONFLICT', '同一业务键对应不同参数')
      return success(previous.result)
    }
    return auction.write(() => {
      const result = action()
      auction.data.keys[token] = { signature, result: structuredClone(result) }
      return success(result, 201)
    })
  }
  const orderView = (order, user, now) => ({ ...order, can_pay: order.buyer_id === user.user_id && order.status === 'PENDING_PAYMENT' && now < Date.parse(order.expires_at) })
  function api(req, res, url, input) {
    const path = url.pathname.slice('/api/v1'.length)
    const method = req.method
    const post = method === 'POST'
    check(post || method === 'GET', 405, 'INVALID_ARGUMENT', '不支持此请求方式')
    const now = clock()
    auction.advance(now, broadcast)
    const user = sessionUser(req)
    const search = url.searchParams
    if (post && path === '/auth/register') return success(auction.write(() => publicUser(auction.register(input))), 201)
    if (post && path === '/auth/login') {
      const identity = auction.login(input)
      const token = randomUUID()
      sessions.delete(sessionId(req))
      sessions.set(token, identity.user_id)
      res.setHeader('Set-Cookie', 'auction_session=' + token + '; HttpOnly; SameSite=Strict; Path=/')
      return success(publicUser(identity))
    }
    if (post && path === '/auth/logout') {
      const sid = sessionId(req)
      sessions.delete(sid)
      for (const ws of sockets.clients) if (sid && ws.sid === sid) ws.close()
      res.setHeader('Set-Cookie', 'auction_session=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/')
      return success(null, 204)
    }
    if (!post && path === '/rounds') {
      const rows = sorted(auction.data.rounds.filter(r => r.state.status !== 'CLOSED')).filter(c =>
        (!search.get('q') || c.title.toLowerCase().includes(search.get('q').toLowerCase())) &&
        (!search.get('status') || c.status === search.get('status')) &&
        (!search.get('category_code') || c.category_code === search.get('category_code')))
      return list(rows, search, 'hall')
    }
    const match = path.match(/^\/rounds\/([^/]+)(?:\/([^/]+))?$/)
    const round = match && need(auction.round(match[1]))
    if (!post && round && !match[2]) return success({ lot: auction.lot(round.lot_id), state: round.state, server_time: iso(now) })
    check(user, 401, 'AUTH_REQUIRED', '请先登录')
    const uid = user.user_id
    if (!post && path === '/me') return success(publicUser(user))
    if (!post && path === '/me/wallet') return success({ balance: user.balance, frozen_balance: user.frozen_balance })
    if (!post && path === '/me/fund-flows') return list(auction.data.flows.filter(f => f.user_id === uid), search, uid + path)
    if (post && path === '/me/wallet/top-ups') return keyed(req, uid, path, input, () => {
      const value = amount(input.amount)
      const row = auction.flow(user, 'TOP_UP', randomUUID(), value, value, 0, now)
      return { top_up_id: row.biz_id, flow_id: row.flow_id, amount: value }
    })
    if (post && path === '/lots') return success(auction.write(() => auction.createLot(user, input)), 201)
    if (!post && path === '/me/lots') return list(auction.data.lots.filter(l => l.seller_id === uid)
      .map(l => ({ ...l, can_schedule: auction.canSchedule(l) })), search, uid + path)
    if (!post && path === '/me/rounds') return list(sorted(auction.data.rounds.filter(r => r.registrations[uid] || auction.lot(r.lot_id).seller_id === uid)), search, uid + path)
    const create = path.match(/^\/lots\/([^/]+)\/rounds$/)
    if (post && create) return keyed(req, uid, path, input, () => {
      const lot = need(auction.lot(create[1]))
      const { round_id, starts_at, ends_at, status } = auction.createRound(user, lot, input, now).state
      return { lot_id: lot.lot_id, round_id, starts_at, ends_at, status }
    })
    if (round) {
      const resource = match[2]
      if (resource === 'my-registration') {
        const reg = round.registrations[uid]
        if (!post || reg) return success({ registration: reg ?? null })
        return success({ registration: auction.write(() => auction.join(round, user, now)) }, 201)
      }
      if (post && resource === 'bids') {
        const result = auction.write(() => auction.bid(round, user, input.amount, now))
        broadcast(round)
        return success(result)
      }
      if (!post && resource === 'my-bids') return list(round.bids.filter(b => b.user_id === uid), search, uid + path)
      if (!post && resource === 'my-order') {
        const order = auction.order(round.state.round_id)
        const visible = order && (order.buyer_id === uid || order.seller_id === uid)
        return success({ availability: visible ? 'READY' : 'NONE', order: visible ? orderView(order, user, now) : null })
      }
    }
    const payment = path.match(/^\/orders\/([^/]+)\/pay$/)
    if (post && payment) {
      const order = need(auction.data.orders.find(o => o.order_id === payment[1]))
      check(order.buyer_id === uid, 403, 'FORBIDDEN', '仅中拍者可支付')
      check(order.status !== 'EXPIRED', 409, 'ORDER_EXPIRED', '订单已超时')
      if (order.status !== 'PAID') auction.write(() => auction.settle(order, false, now))
      return success(orderView(order, user, now))
    }
    return need(null)
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname.startsWith('/api/v1/')) {
        if (req.method === 'POST' && req.headers.origin) check(req.headers.origin === 'http://' + req.headers.host, 403, 'FORBIDDEN', '来源不匹配')
        const input = req.method === 'POST' ? await jsonBody(req) : {}
        const result = api(req, res, url, input)
        res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
        return res.end(result.status === 204 ? undefined : JSON.stringify(result.body))
      }
      const file = resolve(frontend, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)))
      check(file.startsWith(resolve(frontend) + sep) && mime[extname(file)], 404, 'NOT_FOUND', '未找到页面')
      const data = await readFile(file)
      res.writeHead(200, { 'Content-Type': mime[extname(file)], 'X-Content-Type-Options': 'nosniff' })
      res.end(data)
    } catch (error) {
      const status = error.status || (error.code === 'ENOENT' ? 404 : 500)
      if (status === 500) console.error(error)
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ error: { code: error.status ? error.code : status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR',
        message: error.status ? error.message : '请求未完成', details: error.details || {} } }))
    }
  })
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/api/v1/ws' || (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host)) return socket.destroy()
    sockets.handleUpgrade(req, socket, head, ws => {
      ws.sid = sessionId(req)
      ws.on('error', () => ws.terminate())
      ws.on('message', raw => {
        try {
          const msg = JSON.parse(raw)
          if (msg.type !== 'subscribe' || !auction.round(msg.round_id)) return ws.close(1008)
          ws.round = msg.round_id
          send(ws, { type: 'subscribed', round_id: ws.round })
        } catch { ws.close(1007) }
      })
    })
  })
  const tick = setInterval(() => {
    try {
      const now = clock()
      auction.advance(now, broadcast)
      for (const round of auction.data.rounds) {
        const pending = round.bids.filter(b => b.receipt_status === 'RECEIVED')
        if (pending.length) {
          auction.write(() => pending.forEach(b => { b.receipt_status = 'CONFIRMED' }))
          pending.forEach(b => broadcast(round, b))
        }
      }
      for (const [key, page] of pages) if (page.until <= now) pages.delete(key)
    } catch (error) { console.error('Demo clock:', error.message) }
  }, 400)
  tick.unref()
  server.on('close', () => { clearInterval(tick); sockets.close() })
  return server
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT || 4173)
  createDemo().listen(port, '127.0.0.1', () => console.log('拍物 · 本地竞拍大厅 http://127.0.0.1:' + port))
}
