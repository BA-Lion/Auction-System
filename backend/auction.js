import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const id = () => randomUUID()
export const iso = time => new Date(time).toISOString()
export const maxMoney = 1_000_000_000_000

export function check(condition, status, code, message, details = {}) {
  if (!condition) throw Object.assign(new Error(message), { status, code, details })
}

export function amount(value) {
  check(Number.isSafeInteger(value) && value > 0 && value <= maxMoney, 400, 'INVALID_ARGUMENT', '请输入有效的正整数分金额')
  return value
}

export function label(value, max = 120) {
  check(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max, 400, 'INVALID_ARGUMENT', '请检查输入内容与长度')
  return value.trim()
}

export class Auction {
  constructor(filename, seed = true) {
    this.filename = filename
    this.data = filename && existsSync(filename) ? JSON.parse(readFileSync(filename, 'utf8')) :
      { users: [], lots: [], rounds: [], flows: [], orders: [], keys: {}, platform_income: [] }
    if (seed && !this.data.lots.length) this.write(() => this.seed())
  }

  // One synchronous mutation at a time; expose its events only after the snapshot is durable.
  write(operation) {
    const previous = structuredClone(this.data)
    try {
      const result = operation()
      if (this.filename) {
        mkdirSync(dirname(this.filename), { recursive: true })
        writeFileSync(this.filename + '.tmp', JSON.stringify(this.data), { mode: 0o600 })
        renameSync(this.filename + '.tmp', this.filename)
      }
      return result
    } catch (error) {
      this.data = previous
      throw error
    }
  }

  register({ username, nickname, password }) {
    username = label(username, 64)
    nickname = label(nickname, 40)
    check(typeof password === 'string' && password.length >= 6 && password.length <= 128, 400, 'INVALID_ARGUMENT', '密码长度为 6 至 128 位')
    check(!this.data.users.some(u => u.username === username), 409, 'USERNAME_TAKEN', '用户名已被使用')
    const salt = randomBytes(16).toString('hex')
    const user = { user_id: id(), username, nickname, salt, hash: scryptSync(password, salt, 32).toString('hex'), balance: 0, frozen_balance: 0 }
    this.data.users.push(user)
    return user
  }

  login({ username, password }) {
    const user = this.data.users.find(u => u.username === username)
    check(typeof password === 'string' && password.length <= 128 && user && timingSafeEqual(scryptSync(password, user.salt, 32), Buffer.from(user.hash, 'hex')),
      401, 'INVALID_CREDENTIALS', '用户名或密码不正确')
    return user
  }

  user(uid) { return this.data.users.find(u => u.user_id === uid) }
  lot(lid) { return this.data.lots.find(l => l.lot_id === lid) }
  round(rid) { return this.data.rounds.find(r => r.state.round_id === rid) }
  order(rid) { return this.data.orders.find(o => o.round_id === rid) }

  flow(user, type, biz_id, total, available, frozen, now) {
    const balance = user.balance + available
    const held = user.frozen_balance + frozen
    check(Number.isSafeInteger(balance) && Number.isSafeInteger(held) && balance >= 0 && held >= 0, 409, 'INSUFFICIENT_BALANCE', '钱包余额不足')
    user.balance = balance
    user.frozen_balance = held
    const row = { user_id: user.user_id, flow_id: id(), type, biz_id, amount: total, balance_delta: available, frozen_delta: frozen, created_at: iso(now) }
    this.data.flows.unshift(row)
    return row
  }

  createLot(user, body) {
    const images = body.images ?? []
    check(Array.isArray(images) && images.length <= 8 && images.every(src => typeof src === 'string' && /^(https?:\/\/|\/assets\/)/.test(src)), 400, 'INVALID_ARGUMENT', '图片地址无效')
    const lot = { lot_id: id(), seller_id: user.user_id, title: label(body.title), description: label(body.description, 2000),
      category_code: label(body.category_code, 40), images, status: 'AVAILABLE', current_round_id: null }
    this.data.lots.unshift(lot)
    return lot
  }

  canSchedule(lot) {
    const previous = this.round(lot.current_round_id)
    return lot.status === 'AVAILABLE' && (!previous || previous.state.status === 'CLOSED')
  }

  createRound(user, lot, body, now) {
    check(user.user_id === lot.seller_id, 403, 'FORBIDDEN', '只有拍品所有者可建场')
    check(this.canSchedule(lot), 409, 'LOT_UNAVAILABLE', '拍品已有场次或正在成交')
    const scheduled = body.starts_at !== undefined
    const start = scheduled ? Date.parse(body.starts_at) : now
    check(!scheduled || (Number.isFinite(start) && start > now), 400, 'INVALID_ARGUMENT', '预约开始时间必须晚于现在')
    check(Number.isInteger(body.duration_seconds) && body.duration_seconds > 0 && body.duration_seconds <= 31 * 86400, 400, 'INVALID_ARGUMENT', '时长须在 1 秒至 31 天内')
    const state = { round_id: id(), status: scheduled ? 'WAITING' : 'RUNNING', starts_at: iso(start), ends_at: iso(start + body.duration_seconds * 1000),
      start_price: amount(body.start_price), state_version: 1, bid_version: 0, deadline_version: 0, extension_count: 0,
      current_price: null, leader_bid_id: null, leader_user_id: null, ranking: [], last_extension: false, result: null }
    lot.current_round_id = state.round_id
    if (!scheduled) lot.status = 'PENDING_DEAL'
    const round = { lot_id: lot.lot_id, state, registrations: {}, bids: [] }
    this.data.rounds.unshift(round)
    return round
  }

  join(round, user, now) {
    const existing = round.registrations[user.user_id]
    if (existing) return existing
    const s = round.state
    check(user.user_id !== this.lot(round.lot_id).seller_id, 403, 'OWN_LOT', '卖家不能报名自己的场次')
    check(s.status !== 'CLOSED' && now < Date.parse(s.ends_at), 409, 'ROUND_ENDED', '本场已截止')
    const reg = { registration_id: id(), round_id: s.round_id, deposit_amount: s.start_price, deposit_status: 'FROZEN' }
    this.flow(user, 'DEPOSIT_FREEZE', reg.registration_id, s.start_price, -s.start_price, s.start_price, now)
    round.registrations[user.user_id] = reg
    return reg
  }

  bid(round, user, value, now) {
    const s = round.state
    amount(value)
    check(s.status !== 'WAITING', 409, 'ROUND_NOT_STARTED', '场次尚未开始')
    const end = Date.parse(s.ends_at)
    check(s.status === 'RUNNING' && now < end, 409, 'ROUND_ENDED', '本场已截止')
    check(round.registrations[user.user_id]?.deposit_status === 'FROZEN', 403, 'NOT_REGISTERED', '请先报名')
    const minimum = s.current_price === null ? s.start_price : s.current_price + 1
    check(value >= minimum, 409, 'BID_TOO_LOW', '报价至少为 ' + (minimum / 100).toFixed(2) + ' 元', { minimum_amount: minimum })
    const bid = { bid_id: id(), round_id: s.round_id, user_id: user.user_id, nickname: user.nickname, amount: value,
      accepted_at: iso(now), bid_version: ++s.bid_version, receipt_status: 'RECEIVED' }
    round.bids.unshift(bid)
    const extended = end - now <= 10_000 && s.extension_count < 5
    if (extended) {
      s.ends_at = iso(end + 30_000)
      s.extension_count++
      s.deadline_version++
    }
    s.last_extension = extended && s.extension_count === 5
    s.state_version++
    s.current_price = value
    s.leader_bid_id = bid.bid_id
    s.leader_user_id = user.user_id
    s.ranking = round.bids.slice(0, 10).map(({ bid_id, user_id, nickname, amount, accepted_at }) => ({ bid_id, user_id, nickname, amount, accepted_at }))
    return { ...bid, extended, last_extension: s.last_extension, deadline_sync_pending: false, ends_at: s.ends_at, extension_count: s.extension_count,
      deadline_version: s.deadline_version, current_price: value, leader_bid_id: bid.bid_id, leader_user_id: user.user_id }
  }

  close(round, now) {
    const s = round.state
    const lot = this.lot(round.lot_id)
    s.status = 'CLOSED'
    s.state_version++
    s.last_extension = false
    s.result = s.leader_bid_id ? { kind: 'WON', winner_bid_id: s.leader_bid_id, winner_user_id: s.leader_user_id, final_price: s.current_price } : { kind: 'NO_BIDS' }
    for (const [uid, reg] of Object.entries(round.registrations)) {
      if (uid === s.leader_user_id) continue
      this.flow(this.user(uid), 'DEPOSIT_RELEASE', reg.registration_id, reg.deposit_amount, reg.deposit_amount, -reg.deposit_amount, now)
      reg.deposit_status = 'RELEASED'
    }
    if (!s.leader_bid_id) { lot.status = 'AVAILABLE'; return }
    const deposit = round.registrations[s.leader_user_id].deposit_amount
    const order = { order_id: id(), round_id: s.round_id, seller_id: lot.seller_id, buyer_id: s.leader_user_id,
      deal_amount: s.current_price, deposit_amount: deposit, remaining_amount: s.current_price - deposit,
      expires_at: iso(Date.parse(s.ends_at) + 7200_000), status: 'PENDING_PAYMENT', paid_at: null, closed_at: null, settled_at: null }
    this.data.orders.push(order)
    if (!order.remaining_amount) this.settle(order, false, now)
  }

  settle(order, expired, now) {
    const round = this.round(order.round_id)
    const reg = round.registrations[order.buyer_id]
    check(reg.deposit_status === 'FROZEN', 409, 'INVALID_DEPOSIT', '押金状态异常')
    const total = expired ? order.deposit_amount : order.deal_amount
    const fee = Math.floor(total * (expired ? 5000 : 1000) / 10000)
    this.flow(this.user(order.buyer_id), expired ? 'DEPOSIT_FORFEIT' : 'PURCHASE', order.order_id, total, expired ? 0 : -order.remaining_amount, -order.deposit_amount, now)
    this.flow(this.user(order.seller_id), expired ? 'DEFAULT_COMPENSATION' : 'SALE_SETTLEMENT', order.order_id, total - fee, total - fee, 0, now)
    this.data.platform_income.push({ flow_id: id(), order_id: order.order_id, amount: fee })
    reg.deposit_status = expired ? 'FORFEITED' : 'APPLIED'
    order.status = expired ? 'EXPIRED' : 'PAID'
    order.settled_at = iso(now)
    order[expired ? 'closed_at' : 'paid_at'] = iso(now)
    order.platform_amount = fee
    order.seller_amount = total - fee
    const lot = this.lot(round.lot_id)
    if (lot.current_round_id === order.round_id) lot.status = expired ? 'AVAILABLE' : 'SOLD'
  }

  advance(now, publish = () => {}) {
    for (const round of this.data.rounds) {
      const s = round.state
      if (s.status === 'CLOSED') continue
      const end = now >= Date.parse(s.ends_at)
      if (!end && !(s.status === 'WAITING' && now >= Date.parse(s.starts_at))) continue
      this.write(() => {
        if (end) this.close(round, now)
        else { s.status = 'RUNNING'; s.state_version++; this.lot(round.lot_id).status = 'PENDING_DEAL' }
      })
      publish(round)
    }
    for (const order of this.data.orders) {
      if (order.status === 'PENDING_PAYMENT' && now >= Date.parse(order.expires_at)) this.write(() => this.settle(order, true, now))
    }
  }

  seed() {
    const seller = this.register({ username: 'catalogue-' + id(), nickname: '典藏选物', password: id() })
    const now = Date.now()
    const items = [
      ['经典旁轴相机', '摄影器材', '金属机身与手动对焦镜头，保留了胶片时代的机械手感。', 'camera', 68000, 7200],
      ['胡桃木黑胶唱机', '声音器物', '木质底座搭配唱臂，适合安静的唱片聆听空间。', 'turntable', 42000, 3600],
      ['复古工作台灯', '家居设计', '可调节灯头与柔和的阅读光线，适合书桌一角。', 'lamp', 16000, 5400]
    ]
    for (const [title, category_code, description, image, start_price, duration_seconds] of items) {
      const lot = this.createLot(seller, { title, category_code, description, images: ['/assets/' + image + '.jpg'] })
      this.createRound(seller, lot, { start_price, duration_seconds, ...(image === 'lamp' ? { starts_at: iso(now + 900_000) } : {}) }, now)
    }
  }
}
