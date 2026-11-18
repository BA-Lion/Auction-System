import { $, api, badge, countdown, date, empty, esc, fen, icon, money, note, picture, refreshLabel, session } from './ui.js'

const depositText = { FROZEN:'已冻结', RELEASED:'已解冻', APPLIED:'已抵扣', FORFEITED:'已扣除' }
const receiptText = { RECEIVED:'已接收', CONFIRMED:'已确认', PENDING_REVIEW:'待核对' }
const priority = { RECEIVED:0, PENDING_REVIEW:1, CONFIRMED:2 }
export function room(main, rid, active, auth) {
  const path = '/rounds/' + encodeURIComponent(rid)
  let state, lot, reg, order, availability, offset = 0, ws, retry, generation = 0
  let requestBusy = false, queued = false, bidBusy = false, gone = false, lastCheck = 0
  const receipts = new Map()
  main.innerHTML = '<div class="crumb"><a href="#hall">← 竞拍大厅</a><button id="reload" class="outline">' + refreshLabel + '</button></div>' +
    '<div class="room-layout"><section><div class="room-pic" id="photo"></div><div class="panel"><small id="classification"></small><h1 id="title">正在读取场次…</h1><p id="description"></p></div></section>' +
    '<section class="panel bid-panel"><div class="split"><span id="phase"></span><small id="live">连接中</small></div><p id="price-label">当前价</p><div class="price" id="price">—</div><div class="deadline"><span id="clock-label">距截止</span><b class="digits" id="clock">—</b></div>' +
    '<p id="extension"></p><div id="outcome"></div><div id="eligibility"></div><form id="bid-form" hidden><label>我的报价（元）<input id="bid-amount" inputmode="decimal" type="number" min=".01" step=".01" required></label><button type="submit" class="primary">确认出价</button></form><p class="error" role="status" id="bid-feedback"></p><div id="order"></div></section></div>' +
    '<div class="room-lower"><section class="panel"><h2>出价榜 <small>TOP 10</small></h2><div id="rank"></div></section><section class="panel"><h2>我的出价</h2><div id="mine"></div></section></div>'
  const lastHtml = new Map()
  const put = (sel, html) => {
    if (lastHtml.get(sel) === html) return
    $(sel, main).innerHTML = html
    lastHtml.set(sel, html)
  }
  function clock() {
    if (!state || !active()) return
    const waiting = state.status === 'WAITING'
    $('#clock-label').textContent = waiting ? '距开拍' : state.status === 'CLOSED' ? '关场时间' : '距截止'
    $('#clock').textContent = state.status === 'CLOSED' ? date(state.ends_at) : countdown(waiting ? state.starts_at : state.ends_at, offset)
  }
  function render() {
    if (!state || !active()) return
    put('#phase', badge(state.status))
    $('#price-label').textContent = state.result?.kind === 'WON' ? '成交价' : state.current_price === null ? '起拍价 · 暂无出价' : '当前最高价'
    $('#price').textContent = money(state.current_price ?? state.start_price)
    $('#extension').textContent = state.extension_count ? '已加时 ' + state.extension_count + ' / 5 次' + (state.extension_count === 5 ? ' · 已达上限' : '') : ''
    let outcome = ''
    if (state.result?.kind === 'NO_BIDS') outcome = '本场无人出价，已流拍'
    else if (state.result?.kind === 'WON') outcome = state.result.winner_user_id === session.user?.user_id ? '你已中拍' : '本场已成交裁决'
    else if (state.status === 'CLOSED') outcome = '等待正式结果'
    else if (state.leader_user_id && state.leader_user_id === session.user?.user_id) outcome = '你当前领先，可继续出价'
    $('#outcome').textContent = outcome
    const ended = state.status === 'CLOSED' || Date.now() + offset >= Date.parse(state.ends_at)
    let action = ''
    if (reg) action = '报名押金 ' + money(reg.deposit_amount) + ' · ' + depositText[reg.deposit_status]
    else if (lot && session.user?.user_id === lot.seller_id) action = '你是本场卖家'
    else if (ended) action = state.status === 'CLOSED' ? '' : '已到截止时间，正在等待关场'
    else if (session.user && reg === undefined) action = '正在读取报名状态…'
    else action = '<button class="primary" id="join">' + (session.user ? '报名参拍 · 冻结 ' + money(state.start_price) : '登录后报名') + '</button>'
    put('#eligibility', action)
    if ($('#join')) $('#join').onclick = async e => {
      if (!session.user) return auth()
      e.currentTarget.disabled = true
      try { await api(path + '/my-registration', {}); if (active()) { note('报名成功'); await refresh() } }
      catch (err) { if (active()) { note(err.message); render() } }
    }
    const form = $('#bid-form')
    form.hidden = ended || state.status !== 'RUNNING' || reg?.deposit_status !== 'FROZEN'
    $('#bid-amount').placeholder = ((state.current_price === null ? state.start_price : state.current_price + 1) / 100).toFixed(2)
    $('button', form).disabled = bidBusy
    put('#rank', state.ranking.length ? state.ranking.map((b,i) => '<div class="rank-row"><span class="pos">' + String(i+1).padStart(2,'0') +
      '</span><div><b>' + esc(b.nickname) + (b.user_id === session.user?.user_id ? ' · 我' : '') + '</b><small>' + date(b.accepted_at) + '</small></div><strong>' + money(b.amount) + '</strong></div>').join('') : empty('等待第一笔有效出价'))
    const records = [...receipts.values()].sort((a,b) => b.bid_version - a.bid_version)
    put('#mine', records.length ? records.map(b => '<div class="row"><div><b>' + money(b.amount) + '</b><small>' + date(b.accepted_at) +
      '</small></div><span>' + receiptText[b.receipt_status] + '</span></div>').join('') : empty(session.user ? '暂无个人出价' : '登录后查看个人回执'))
    if (order) {
      const words = { PAID:'已支付', EXPIRED:'已超时关闭', PENDING_PAYMENT:'待支付' }
      put('#order', '<hr><h3>中拍订单 · ' + words[order.status] + '</h3><p>成交 ' + money(order.deal_amount) + ' · 押金 ' + money(order.deposit_amount) +
        ' · 尾款 ' + money(order.remaining_amount) + '</p>' + (order.status === 'PENDING_PAYMENT' ? '<small>付款截止 ' + date(order.expires_at) + '</small>' : '') +
        (order.can_pay && Date.now() + offset < Date.parse(order.expires_at) ? '<button class="primary" id="pay">支付尾款 ' + money(order.remaining_amount) + '</button>' : ''))
      if ($('#pay')) $('#pay').onclick = async e => {
        e.currentTarget.disabled = true
        try { await api('/orders/' + order.order_id + '/pay', {}); if (active()) { note('付款成功'); await refresh() } }
        catch (err) { if (active()) { note(err.message); await refresh() } }
      }
    } else put('#order', availability === 'CREATING' ? '订单生成中' : '')
    clock()
  }
  function accept(s) {
    if (s.round_id !== rid || (state && s.state_version < state.state_version)) return
    state = s
  }
  function merge(b) {
    const old = receipts.get(b.bid_id)
    if (b.round_id === rid && (!old || priority[b.receipt_status] >= priority[old.receipt_status])) receipts.set(b.bid_id, b)
  }
  async function refresh() {
    if (!active()) return
    if (requestBusy) { queued = true; return }
    requestBusy = true
    const rev = ++generation
    const button = $('#reload')
    button.disabled = true; button.textContent = '刷新中…'
    const reads = [api(path)]
    if (session.user) reads.push(api(path + '/my-registration'), api(path + '/my-bids'), api(path + '/my-order'))
    const results = await Promise.allSettled(reads)
    if (!active() || rev !== generation) return
    const [snapshot, registration, bids, purchase] = results
    if (snapshot.status === 'fulfilled') {
      const data = snapshot.value
      lot = data.lot; accept(data.state); offset = Date.parse(data.server_time) - Date.now()
      $('#title').textContent = lot.title; $('#description').textContent = lot.description; $('#classification').textContent = lot.category_code
      if ($('#photo').dataset.lot !== lot.lot_id) { put('#photo', picture(lot)); $('#photo').dataset.lot = lot.lot_id }
    }
    if (registration?.status === 'fulfilled') reg = registration.value.registration
    if (bids?.status === 'fulfilled') bids.value.items.forEach(merge)
    if (purchase?.status === 'fulfilled') { order = purchase.value.order; availability = purchase.value.availability }
    const failure = results.find(x => x.status === 'rejected')
    if (failure) { note(failure.reason.message + '，可点击刷新重试'); if (!lot) $('#title').textContent = '场次读取失败' }
    render()
    button.innerHTML = refreshLabel; button.disabled = false; requestBusy = false
    if (queued) { queued = false; refresh() }
  }
  $('#reload').onclick = refresh
  $('#bid-form').onsubmit = async e => {
    e.preventDefault()
    if (bidBusy) return
    const input = $('#bid-amount')
    let value
    try { value = fen(input.value) } catch (err) { note(err.message); return }
    bidBusy = true; render()
    try {
      const b = await api(path + '/bids', { amount: value })
      if (!active()) return
      merge(b); input.value = ''
      $('#bid-feedback').textContent = '报价已接收' + (b.extended ? ' · 本次加时 30 秒' : '')
    } catch (err) {
      if (!active()) return
      const uncertain = !err.code || err.code === 'BID_OUTCOME_UNKNOWN'
      $('#bid-feedback').textContent = uncertain ? '提交结果待核对，请查看个人回执。' : err.message
    } finally { bidBusy = false; if (active()) { render(); refresh() } }
  }
  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/v1/ws')
    ws.onopen = () => ws.send(JSON.stringify({ type:'subscribe', round_id:rid }))
    ws.onmessage = e => {
      if (!active()) return
      const msg = JSON.parse(e.data)
      if (msg.type === 'subscribed') { $('#live').textContent = '● 实时连接'; refresh() }
      if (msg.type === 'round.updated') { accept(msg.state); render(); if (msg.state.status === 'CLOSED') refresh() }
      if (msg.type === 'bid.receipt') { merge(msg.record); render() }
    }
    ws.onclose = () => { if (!gone && active()) { $('#live').textContent = '连接中断 · 可手动刷新'; retry = setTimeout(connect, 1800) } }
  }
  refresh(); connect()
  const timer = setInterval(() => {
    clock()
    if (!state || requestBusy) return
    const now = Date.now() + offset
    const transitionDue = (state.status === 'WAITING' && now >= Date.parse(state.starts_at)) ||
      (state.status === 'RUNNING' && now >= Date.parse(state.ends_at))
    const fundsDue = availability === 'CREATING' ||
      (order?.status === 'PENDING_PAYMENT' && now >= Date.parse(order.expires_at)) ||
      (state.status === 'CLOSED' && state.result && reg?.deposit_status === 'FROZEN' && state.result.winner_user_id !== session.user?.user_id)
    if ((transitionDue || fundsDue) && Date.now() - lastCheck >= 2000) {
      lastCheck = Date.now(); render(); refresh()
    }
  }, 500)
  return () => { gone = true; clearTimeout(retry); clearInterval(timer); ws?.close() }
}
