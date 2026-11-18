export const $ = (selector, root = document) => root.querySelector(selector)
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
export const money = value => '¥' + (value / 100).toLocaleString('zh-CN', { minimumFractionDigits: value % 100 ? 2 : 0, maximumFractionDigits: 2 })
export const date = value => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
export const session = { user: null }
export async function api(path, body, key) {
  const response = await fetch('/api/v1' + path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) })
  const data = response.status === 204 ? null : await response.json()
  if (!response.ok) throw Object.assign(new Error(data?.error?.message || '请求失败'), { code: data?.error?.code })
  return data
}
export function fen(value) {
  const raw = String(value).trim()
  if (!/^\d+(\.\d{1,2})?$/.test(raw) || Number(raw) <= 0) throw new Error('请输入大于零且最多两位小数的金额')
  const [whole, fraction = ''] = raw.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}
let toastTimer
export function note(text) {
  const el = $('#notice')
  el.textContent = text
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 3800)
}
const icons = { refresh: 'M20 7v5h-5 M4 17v-5h5 M5.6 8a7 7 0 0 1 11.5-2L20 9 M4 15l3 3a7 7 0 0 0 11.5-2', search: 'M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 1 1 14 0', arrow: 'M4 12h15 M13 6l6 6-6 6', clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0 M12 6v6l4 2' }
export const icon = name => '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="' + icons[name] + '"/></svg>'
export const refreshLabel = icon('refresh') + ' 刷新'
export const badge = s => '<span class="badge ' + s + '"><i></i>' + ({ RUNNING: '竞拍中', WAITING: '待开拍', CLOSED: '已结束' }[s]) + '</span>'
export const cats = ['摄影器材','声音器物','家居设计','艺术收藏','其他']
export const opts = (values, chosen) => values.map(x => '<option' + (x === chosen ? ' selected' : '') + '>' + esc(x) + '</option>').join('')
export function picture(item) {
  const source = item.images?.[0]
  return source ? '<img src="' + esc(source) + '" alt="' + esc(item.title) + '">' : '<div class="blank-art"><span>' + esc(item.title.slice(0, 1)) + '</span></div>'
}
export function card(c) {
  return '<a class="card" href="#round/' + esc(c.round_id) + '"><div class="card-pic">' + picture(c) + badge(c.status) +
    '</div><div class="card-body"><small>' + esc(c.category_code) + '</small><h3>' + esc(c.title) +
    '</h3><div class="card-bottom"><div><small>' + (c.current_price === null ? '起拍价' : '当前价') + '</small><strong>' +
    money(c.current_price ?? c.start_price) + '</strong></div><span class="arrow-box">' + icon('arrow') + '</span></div><small class="card-time">' +
    icon('clock') + ' ' + date(c.status === 'WAITING' ? c.starts_at : c.ends_at) + (c.status === 'WAITING' ? ' 开拍' : ' 截止') + '</small></div></a>'
}
export function countdown(time, offset = 0) {
  const n = Math.max(0, Math.ceil((Date.parse(time) - Date.now() - offset) / 1000))
  return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60].map(v => String(v).padStart(2, '0')).join(':')
}
export function fields(form) { return Object.fromEntries(new FormData(form)) }
export function modal(title, content) {
  $('#sheet').innerHTML = '<div class="modal-head"><h2>' + esc(title) + '</h2><button class="close" aria-label="关闭">×</button></div>' + content
  $('.close', $('#sheet')).onclick = () => $('#modal').close()
  if (!$('#modal').open) $('#modal').showModal()
}
export function submit(form, run) {
  form.onsubmit = async e => {
    e.preventDefault()
    const button = $('button[type=submit]', form)
    if (button.disabled) return
    button.disabled = true
    const error = $('.error', form)
    if (error) error.textContent = ''
    try { await run(fields(form)) }
    catch (err) { if (error) error.textContent = err.message; else note(err.message) }
    finally { button.disabled = false }
  }
}
export const formEnd = title => '<p class="error" role="alert"></p><button class="primary" type="submit">' + title + '</button></form>'
export const empty = message => '<div class="empty">' + esc(message) + '</div>'
