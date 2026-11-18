import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'
import { createDemo } from './server.js'

async function fixture(t) {
  let now = Date.parse('2026-11-18T07:00:00Z')
  const server = createDemo({ filename: null, seed: false, clock: () => now })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = '127.0.0.1:' + server.address().port
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
  function session() {
    let cookie = ''
    async function request(path, data, key) {
      const r = await fetch('http://' + address + '/api/v1' + path, {
        method: data === undefined ? 'GET' : 'POST', headers: { cookie, 'content-type':'application/json', ...(key ? { 'Idempotency-Key':key } : {}) },
        body: JSON.stringify(data)
      })
      if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0]
      return { status:r.status, body:r.status === 204 ? null : await r.json() }
    }
    return { request, cookie: () => cookie }
  }
  async function account(name) {
    const client = session()
    const data = { username:name, nickname:name, password:'demo-user-123' }
    assert.equal((await client.request('/auth/register', data)).status, 201)
    const login = await client.request('/auth/login', data)
    assert.equal(login.status, 200)
    return { ...client, id:login.body.user_id }
  }
  async function open(seller, extra = {}) {
    const lot = (await seller.request('/lots', { title:'测试相机', description:'竞拍验收', category_code:'摄影器材' })).body
    const path = '/lots/' + lot.lot_id + '/rounds'
    const data = { start_price:10000, duration_seconds:20, ...extra }, key = randomUUID()
    const result = await seller.request(path, data, key)
    assert.equal(result.status, 201)
    assert.equal((await seller.request(path, data, key)).body.round_id, result.body.round_id)
    return { rid:result.body.round_id, path:'/rounds/' + result.body.round_id, lot }
  }
  return { account, open, address, time:() => now, advance:ms => { now += ms } }
}

test('多会话报价、订阅、加时、冻结与成交结算', { timeout:15000 }, async t => {
  const f = await fixture(t)
  const seller = await f.account('seller'), a = await f.account('buyer-a'), b = await f.account('buyer-b')
  const { path, rid } = await f.open(seller)
  for (const client of [a,b]) {
    const key = randomUUID()
    assert.equal((await client.request('/me/wallet/top-ups', { amount:50000 }, key)).status, 201)
    assert.equal((await client.request('/me/wallet/top-ups', { amount:50000 }, key)).status, 200)
    assert.equal((await client.request('/me/wallet/top-ups', { amount:50100 }, key)).status, 409)
    assert.equal((await client.request(path + '/my-registration', {})).status, 201)
    assert.equal((await client.request(path + '/my-registration', {})).status, 200)
    assert.deepEqual((await client.request('/me/wallet')).body, { balance:40000, frozen_balance:10000 })
  }
  assert.equal((await seller.request(path + '/my-registration', {})).body.error.code, 'OWN_LOT')
  const ws = new WebSocket('ws://' + f.address + '/api/v1/ws', { headers:{ cookie:a.cookie() } })
  t.after(() => ws.terminate())
  await once(ws, 'open')
  const subscribed = once(ws, 'message')
  ws.send(JSON.stringify({ type:'subscribe', round_id:rid }))
  assert.equal(JSON.parse((await subscribed)[0]).type, 'subscribed')
  f.advance(10000)
  const update = once(ws, 'message')
  const first = await Promise.all([a,b].map(client => client.request(path + '/bids', { amount:10000 })))
  assert.deepEqual(first.map(r => r.status).sort(), [200,409])
  assert.equal(JSON.parse((await update)[0]).state.extension_count, 1)
  assert.equal(first.find(r => r.status === 409).body.error.details.minimum_amount, 10001)
  for (const n of [10001,23000]) assert.equal((await a.request(path + '/bids', { amount:n })).body.extended, false)
  const state = (await a.request(path)).body.state
  assert.deepEqual(state.ranking.map(r => r.amount), [23000,10001,10000])
  assert.equal(state.leader_user_id, a.id)
  await new Promise(resolve => setTimeout(resolve, 550))
  assert.ok((await a.request(path + '/my-bids')).body.items.every(r => r.receipt_status === 'CONFIRMED'))
  assert.equal((await b.request(path + '/my-order')).body.availability, 'NONE')
  f.advance(40000)
  assert.equal((await b.request(path)).body.state.result.final_price, 23000)
  const order = (await a.request(path + '/my-order')).body.order
  const pay = '/orders/' + order.order_id + '/pay'
  assert.equal((await b.request(pay, {})).status, 403)
  assert.equal((await a.request(pay, {})).body.status, 'PAID')
  assert.equal((await a.request(pay, {})).body.remaining_amount, 13000)
  assert.deepEqual((await a.request('/me/wallet')).body, { balance:27000, frozen_balance:0 })
  assert.deepEqual((await b.request('/me/wallet')).body, { balance:50000, frozen_balance:0 })
  assert.equal((await seller.request('/me/wallet')).body.balance, 20700)
  assert.equal((await b.request('/rounds')).body.items.length, 0)
  assert.equal((await b.request('/me/rounds')).body.items.length, 1)
  ws.close()
  await once(ws,'close')
})

test('预约、五次加时封顶、超时补偿及重新建场', async t => {
  const f = await fixture(t)
  const s = await f.account('seller'), a = await f.account('buyer')
  const { path, lot } = await f.open(s, { starts_at:new Date(f.time()+2000).toISOString(), duration_seconds:10 })
  assert.equal((await s.request('/me/lots')).body.items[0].can_schedule, false)
  await a.request('/me/wallet/top-ups', { amount:10000 }, 'deposit')
  await a.request(path + '/my-registration', {})
  assert.equal((await a.request(path + '/bids', { amount:10000 })).body.error.code, 'ROUND_NOT_STARTED')
  f.advance(2000)
  for (let i=0; i<6; i++) {
    const bid = (await a.request(path + '/bids', { amount:10000+i })).body
    assert.equal(bid.extension_count, Math.min(i+1,5))
    assert.equal(bid.last_extension, i===4)
    if (i<5) f.advance(30000)
  }
  f.advance(10000)
  const order = (await a.request(path + '/my-order')).body.order
  assert.equal((await a.request('/orders/' + order.order_id + '/pay', {})).body.error.code,'INSUFFICIENT_BALANCE')
  f.advance(7200000)
  assert.equal((await a.request(path + '/my-order')).body.order.status, 'EXPIRED')
  assert.equal((await a.request(path + '/my-registration')).body.registration.deposit_status, 'FORFEITED')
  assert.equal((await s.request('/me/wallet')).body.balance, 5000)
  const again = await s.request('/lots/' + lot.lot_id + '/rounds', { start_price:20000, duration_seconds:1 }, 'again')
  assert.equal(again.status,201)
  f.advance(1000)
  assert.equal((await s.request('/rounds/' + again.body.round_id)).body.state.result.kind,'NO_BIDS')
})

test('刷新大厅重取首页，旧游标保持原快照，零尾款直接结算', async t => {
  const f = await fixture(t)
  const seller = await f.account('seller'), buyer = await f.account('buyer')
  const first = await f.open(seller, { duration_seconds:60 })
  f.advance(1000)
  await f.open(seller, { duration_seconds:600 })
  const initial = await buyer.request('/rounds?limit=1')
  const cursor = initial.body.next_cursor
  assert.ok(cursor)
  await buyer.request('/me/wallet/top-ups', { amount:10000 }, 'top')
  await buyer.request(first.path + '/my-registration', {})
  await buyer.request(first.path + '/bids', { amount:10000 })
  const old = await buyer.request('/rounds?cursor=' + cursor)
  assert.equal(old.body.items[0].round_id, first.rid)
  assert.equal(old.body.items[0].current_price, null)
  assert.equal((await buyer.request('/rounds')).body.items.find(c => c.round_id === first.rid).current_price,10000)
  f.advance(59000)
  const order = (await buyer.request(first.path + '/my-order')).body.order
  assert.equal(order.status, 'PAID')
  assert.equal(order.remaining_amount, 0)
  assert.equal((await seller.request('/me/wallet')).body.balance, 9000)
  const purchase = (await buyer.request('/me/fund-flows')).body.items.find(row => row.type === 'PURCHASE')
  assert.deepEqual([purchase.amount, purchase.balance_delta, purchase.frozen_delta], [10000,0,-10000])
  f.advance(300000)
  assert.equal((await buyer.request('/rounds?cursor=' + cursor)).status, 410)
})
