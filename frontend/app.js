import { $, api, badge, card, cats, countdown, date, empty, esc, fen, formEnd, icon, modal, money, note, opts, picture, refreshLabel, session, submit } from './ui.js'
import { room } from './room.js'

const main = $('#main')
let renderId = 0
let unmount = () => {}
const filters = { q: '', category_code: '', status: '' }
function identity() {
  $('#identity').innerHTML = session.user ? '<button class="account" id="profile">' + esc(session.user.nickname) + ' ▾</button>' :
    '<button class="primary" id="sign">登录 / 注册</button>'
  if ($('#sign')) $('#sign').onclick = () => auth()
  if ($('#profile')) $('#profile').onclick = () => {
    modal('我的账号', '<p>' + esc(session.user.nickname) + ' · ' + esc(session.user.username) + '</p><button class="outline" id="logout">退出登录</button>')
    $('#logout').onclick = async () => {
      try { await api('/auth/logout', {}); session.user = null; $('#modal').close(); identity(); route() }
      catch (e) { note(e.message) }
    }
  }
}
function auth(register = false) {
  modal(register ? '创建账号' : '登录拍物', '<form id="auth"><label>用户名<input name="username" autocomplete="username" maxlength="64" required></label>' +
    (register ? '<label>昵称<input name="nickname" maxlength="40" required></label>' : '') +
    '<label>密码<input name="password" type="password" minlength="6" maxlength="128" autocomplete="' + (register ? 'new-password' : 'current-password') + '" required></label>' +
    formEnd(register ? '注册并登录' : '登录') + '<button class="link switch">' + (register ? '已有账号，去登录' : '没有账号？创建账号') + '</button>')
  $('.switch').onclick = () => auth(!register)
  submit($('#auth'), async data => {
    if (register) await api('/auth/register', data)
    session.user = await api('/auth/login', { username: data.username, password: data.password })
    $('#modal').close(); identity(); route()
  })
}
function heading(title, action = '') {
  return '<div class="pagehead"><h1>' + title + '</h1>' + action + '</div>'
}
function hall(active) {
  main.innerHTML = '<section id="feature"></section>' + heading('竞拍大厅', '<button class="outline" id="refresh">' + refreshLabel + '</button>') +
    '<div class="toolbar"><div class="tabs" id="tabs">' + [['','全部场次'],['RUNNING','竞拍中'],['WAITING','待开拍']].map(([v,t]) =>
      '<button data-status="' + v + '" class="' + (filters.status === v ? 'sel' : '') + '">' + t + '</button>').join('') +
    '</div><div class="tools"><label class="search">' + icon('search') + '<input id="query" aria-label="搜索拍品" placeholder="搜索拍品" value="' + esc(filters.q) +
    '"></label><select id="category" aria-label="拍品分类"><option value="">全部分类</option>' + opts(cats, filters.category_code) +
    '</select></div></div><div id="listing" class="grid"></div><button id="more" class="outline more" hidden>加载更多</button>'
  let generation = 0, rows = [], cursor = null, typing
  function feature(item) {
    if (!item) return ''
    return '<article class="feature"><div class="feature-text"><div class="feature-kicker"><i></i> 本场精选</div><div><small>' +
      esc(item.category_code) + '</small><h2>' + esc(item.title) + '</h2></div><div class="feature-meta"><span>' + (item.current_price === null ? '起拍价' : '当前价') +
      '<b>' + money(item.current_price ?? item.start_price) + '</b></span><span>' + (item.status === 'WAITING' ? '距开拍' : '距截止') +
      '<b class="digits" data-until="' + esc(item.status === 'WAITING' ? item.starts_at : item.ends_at) + '"></b></span></div><a class="light-btn" href="#round/' +
      esc(item.round_id) + '">进入专场 ' + icon('arrow') + '</a></div><div class="feature-pic">' + picture(item) + '</div></article>'
  }
  const tick = () => { const el = $('[data-until]', main); if (el) el.textContent = countdown(el.dataset.until) }
  async function load(more = false) {
    if (more && !cursor) return
    const version = more ? generation : ++generation
    const btn = $(more ? '#more' : '#refresh'); btn.disabled = true
    if (!more) { btn.textContent = '刷新中…'; cursor = null; $('#more').hidden = true }
    try {
      const query = more ? { cursor } : Object.fromEntries(Object.entries(filters).filter(([,v]) => v))
      const data = await api('/rounds?' + new URLSearchParams(query))
      if (!active() || version !== generation) return
      rows = more ? rows.concat(data.items) : data.items
      cursor = data.next_cursor
      $('#listing').innerHTML = rows.length ? rows.map(card).join('') : empty('暂无符合条件的场次')
      $('#more').hidden = !cursor
      $('#more').disabled = false
      const hasFilter = Object.values(filters).some(Boolean)
      $('#feature').innerHTML = hasFilter ? '' : feature(rows.find(r => r.images?.[0]?.endsWith('/camera.jpg')) ?? rows[0])
      tick()
    } catch (e) { if (active() && version === generation) note(e.message) }
    finally { if (active() && version === generation) { btn.disabled = false; if (!more) btn.innerHTML = refreshLabel } }
  }
  $('#refresh').onclick = () => load()
  $('#more').onclick = () => load(true)
  $('#category').onchange = e => { filters.category_code = e.target.value; load() }
  $('#query').oninput = e => { filters.q = e.target.value.trim(); clearTimeout(typing); typing = setTimeout(load, 180) }
  $('#tabs').onclick = e => { if (e.target.dataset.status !== undefined) {
    filters.status = e.target.dataset.status
    for (const b of $('#tabs').children) b.classList.toggle('sel', b === e.target)
    load()
  } }
  const timer = setInterval(tick, 500)
  unmount = () => { generation++; clearTimeout(typing); clearInterval(timer) }
  load()
}
function publishLot() {
  modal('保存新拍品', '<form id="publish"><label>拍品名称<input name="title" maxlength="120" required></label><label>分类<select name="category_code">' +
    opts(cats) + '</select></label><label>拍品描述<textarea name="description" rows="4" maxlength="2000" required></textarea></label>' + formEnd('保存拍品'))
  submit($('#publish'), async data => { await api('/lots', data); $('#modal').close(); note('拍品已保存，可继续创建场次'); route() })
}
function schedule(id) {
  modal('创建竞拍场次', '<form id="schedule"><label>起拍价（元）<input name="price" type="number" min=".01" step=".01" required></label>' +
    '<label>竞拍时长（秒）<input name="seconds" type="number" min="1" max="2678400" value="120" required></label>' +
    '<label>开拍方式<select name="mode"><option value="now">立即开拍</option><option value="later">预约开拍</option></select></label>' +
    '<label id="schedule-time" hidden>开拍时间<input name="start" type="datetime-local"></label>' + formEnd('创建场次'))
  const form = $('#schedule')
  form.elements.mode.onchange = () => { const later = form.elements.mode.value === 'later'; $('#schedule-time').hidden = !later; form.elements.start.required = later }
  const key = crypto.randomUUID()
  submit(form, async data => {
    const body = { start_price: fen(data.price), duration_seconds: Number(data.seconds) }
    if (data.mode === 'later') body.starts_at = new Date(data.start).toISOString()
    const r = await api('/lots/' + id + '/rounds', body, key)
    $('#modal').close(); location.hash = 'round/' + r.round_id
  })
}
function topUp() {
  modal('模拟充值', '<form id="topup"><label>充值金额（元）<input type="number" name="amount" min=".01" step=".01" required placeholder="500.00"></label>' + formEnd('确认充值'))
  const key = crypto.randomUUID()
  submit($('#topup'), async data => { await api('/me/wallet/top-ups', { amount: fen(data.amount) }, key); $('#modal').close(); note('充值已到账'); route() })
}
const flowNames = { TOP_UP:'模拟充值', DEPOSIT_FREEZE:'报名冻结', DEPOSIT_RELEASE:'押金解冻', PURCHASE:'竞拍付款', SALE_SETTLEMENT:'成交入账', DEPOSIT_FORFEIT:'押金扣除', DEFAULT_COMPENSATION:'违约补偿' }
async function personal(page, active) {
  const title = { seller:'卖家中心', history:'我的竞拍', wallet:'我的钱包' }[page]
  if (!session.user) {
    main.innerHTML = heading(title) + '<section class="panel gate"><h2>登录后查看' + title + '</h2><button id="enter" class="primary">登录 / 注册</button></section>'
    $('#enter').onclick = () => auth(); return
  }
  const path = { seller:'/me/lots', history:'/me/rounds', wallet:'/me/fund-flows' }[page]
  const [list, balance] = await Promise.all([api(path), page === 'wallet' ? api('/me/wallet') : null])
  if (!active()) return
  main.innerHTML = heading(title, page === 'seller' ? '<button id="newlot" class="primary">＋ 保存拍品</button>' : page === 'wallet' ? '<button id="add" class="primary">模拟充值</button>' : '') +
    (balance ? '<section class="wallet"><div>可用余额<strong>' + money(balance.balance) + '</strong></div><div>冻结金额<strong>' + money(balance.frozen_balance) + '</strong></div></section><h2>钱包流水</h2>' : '') +
    '<div id="records" class="' + (page === 'history' ? 'grid' : 'records') + '"></div><button class="more outline" id="next" hidden>加载更多</button>'
  function record(item) {
    if (page === 'history') return card(item)
    if (page === 'wallet') return '<article class="row"><div><h3>' + esc(flowNames[item.type]) + '</h3><small>' + date(item.created_at) + '</small></div><div class="align-right"><b>' + money(item.amount) +
      '</b><small>可用 ' + money(item.balance_delta) + ' · 冻结 ' + money(item.frozen_delta) + '</small></div></article>'
    const label = { AVAILABLE:'待拍卖', PENDING_DEAL:'待成交', SOLD:'已售出' }[item.status]
    return '<article class="row"><div><small>' + esc(item.category_code) + ' · ' + label + '</small><h3>' + esc(item.title) +
      '</h3></div><div class="actions">' + (item.current_round_id ? '<a class="outline" href="#round/' + esc(item.current_round_id) + '">查看场次</a>' : '') +
      (item.can_schedule ? '<button class="primary" data-lot="' + esc(item.lot_id) + '">创建场次</button>' : '') + '</div></article>'
  }
  function append(batch) {
    $('#records').insertAdjacentHTML('beforeend', batch.items.length ? batch.items.map(record).join('') : empty({wallet:'暂无钱包流水',seller:'尚未保存拍品',history:'尚未开场或报名竞拍'}[page]))
    const next = $('#next'); next.hidden = !batch.next_cursor
    next.onclick = async () => { next.disabled = true; try { const data = await api(path + '?cursor=' + encodeURIComponent(batch.next_cursor)); if (active()) append(data) } catch(e) { note(e.message) } finally { next.disabled = false } }
  }
  append(list)
  if ($('#newlot')) $('#newlot').onclick = publishLot
  if ($('#add')) $('#add').onclick = topUp
  $('#records').onclick = e => { if (e.target.dataset.lot) schedule(e.target.dataset.lot) }
}
async function route() {
  unmount(); unmount = () => {}
  const id = ++renderId, active = () => id === renderId
  const [page, rid] = (location.hash.slice(1) || 'hall').split('/')
  for (const a of document.querySelectorAll('nav a')) a.classList.toggle('active', a.hash === '#' + (page === 'round' ? 'hall' : page))
  main.innerHTML = '<p class="loading">正在读取…</p>'
  window.scrollTo(0,0)
  try {
    if (page === 'round' && rid) unmount = room(main, rid, active, auth)
    else if (['history','seller','wallet'].includes(page)) await personal(page, active)
    else hall(active)
  } catch (err) { if (active()) main.innerHTML = empty(err.message) }
}
try { session.user = await api('/me') } catch { session.user = null }
identity()
window.addEventListener('hashchange', route)
route()
