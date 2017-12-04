// mdht.js -- Mainline DHT with BEP44 data storage. IPv4 only.
//
// Terminology:
//
// location (loc) -- 6-byte buffer, network location (4-byte IPv4 address + 2-byte port)
// peer -- 6-byte buffer, location of a mainlne bittorrent client (TCP) that includes a DHT node, not always having the same port as its node
// id -- 20-byte buffer, a DHT node id or a torrent infohash
// node -- 26-byte buffer (20-byte id + 6-byte location), identfies and locates a DHT node
// contact -- object version of a node { id: 20-byte buffer, loc: 6-byte location bufer }
//
// See README.md for API description.

const crypto = require('crypto')
const dgram = require('dgram')
const ben = require('bencode')
const eds = require('ed25519-supercop')
const Table = require('./table')

// constants and utilities
const ut = {
  idLen: 20,
  locLen: 6,
  nodeLen: 26,
  keyLen: 32,
  sigLen: 64,
  saltLen: 64,
  maxV: 1000,
  numClosest: 8,

  sha1: (buff) => { return crypto.createHash('sha1').update(buff).digest() },
  random: (size) => { return eds.createSeed().slice(0, size) }, // ut.keyLen bytes max
  decToInt: (dec) => { return parseInt(dec, 10) },
  hexToInt: (hex) => { return parseInt(hex, 16) },
  intToHex: (int) => { return int.toString(16) },
  decToHex: (dec) => { return ut.intToHex(ut.decToInt(dec)) },
  buffToHex: (buff) => { return buff.toString('hex') },
  hexToBuff: (hex, numBytes) => {
    hex.length % 2 && (hex = '0' + hex)
    if (numBytes) {
      const num = numBytes * 2; const repeat = num - hex.length
      hex = ('0'.repeat(repeat < 0 ? 0 : repeat) + hex).slice(0, num)
    }
    return Buffer.from(hex, 'hex')
  },
  splitBuff: (buff, size) => {
    const len = buff.length; const arr = []
    for (let i = 0; i < len; i += size) { arr.push(buff.slice(i, i + size)) }
    return arr
  },
  byteMatch: (a, b, match) => { return a.slice(0, match).equals(b.slice(0, match)) },
  intToBuff2: (int) => { return Buffer.from([int >>> 8, int & 0xff]) },
  buff2ToInt: (buff) => { return (buff[0] << 8) + buff[1] },
  makeLoc: (address, port) => { // convert valid IPv4 address(string)/port(number) to 6-byte buffer
    const arr = []
    address.split('.').forEach((dec) => { arr.push(ut.decToInt(dec)) })
    return Buffer.concat([Buffer.from(arr), ut.intToBuff2(port)])
  },
  unmakeLoc: (loc) => { // convert 6-byte buffer to IPv4 address/port
    let str = ''
    for (let i = 0; i < 4; i++) str += loc[i] + (i < 3 ? '.' : '')
    return { address: str, port: ut.buff2ToInt(loc.slice(4)) }
  },
  makeSalt: (salt) => {
    if (!salt) return null
    if (typeof salt === 'string') return ut.sha1(Buffer.from(salt))
    if (Buffer.isBuffer(salt)) return salt.slice(0, ut.saltLen)
    return null
  },
  addContact: (table, id, loc) => {
    const contact = { id: id, loc: loc }
    ut.byteMatch(id, table.id, oq.match) || table.addContact(contact)
    return contact
  },
  makeMutableTarget: (k, salt) => { return ut.sha1(salt ? Buffer.concat([k, salt]) : k) },
  makeImmutableTarget: (v) => { return ut.sha1(ben.encode(v)) },
  packSeqSalt: (seq, v, salt) => {
    const es = (obj) => { return ben.encode(obj).slice(1, -1) }
    const arr = []
    salt && salt.length && arr.push(es({ salt: salt }))
    arr.push(es({ seq: seq }))
    arr.push(es({ v: v }))
    return Buffer.concat(arr)
  }
}

// options and main interval loop
const go = {
  update: null,

  doUpdate: (key, val) => { go.update && go.update(key, val) },

  init: (opts, update) => {
    typeof update === 'function' && (go.update = update)
    Object.entries(opts || {}).forEach(([key, val]) => {
      if (key !== 'port' && !Buffer.isBuffer(val)) return
      switch (key) {
        case 'port': val > 0 && val < 65536 && (sr.port = ~~val); break
        case 'id': val.length === ut.idLen && (my.id = val); break
        case 'seed': val.length === ut.keyLen && (my.keyPair = eds.createKeyPair(val)); break
        case 'bootLocs': val.length % ut.locLen || (my.bootLocs = ut.splitBuff(val, ut.locLen)); break
      }
    })
    go.doUpdate('id', my.id)
    go.doUpdate('publicKey', my.keyPair.publicKey)
    my.table = new Table(my.id)

    setInterval(oq.check, oq.checkInterval) // start outgoing query manager
    sr.init(my.populate) // initialize server and populate my routing table
    setInterval(() => {
      sr.spamReset() // reset spam filter
      my.refreshTable() // ping oldest nodes in my routing table
      iq.newSecret() // create new secret
      ps.update() // update stored peers
      ds.update() // update stored data
    }, 5 * 60 * 1000) // every 5 minutes

    return {
      announcePeer: pi.announcePeer,
      getPeers: pi.getPeers,
      putData: pi.putData,
      getData: pi.getData,
      makeSalt: ut.makeSalt,
      makeMutableTarget: ut.makeMutableTarget,
      makeImmutableTarget: ut.makeImmutableTarget
    }
  }
}

// UDP server
const sr = {
  port: 6881,
  udp: dgram.createSocket('udp4'),
  spam: {},
  spamLimit: 10, // per spamReset interval

  init: (done) => {
    sr.udp.bind(sr.port)
    sr.udp.once('listening', () => { go.doUpdate('listening', sr.udp.address()); done() })
    sr.udp.once('error', (err) => { err && go.doUpdate('udp', sr.port) })
    sr.udp.on('message', (mess, rinfo) => { process.nextTick(sr.recv, mess, rinfo) })
  },

  spamReset: () => { sr.spam = {} },

  send: (mess, loc) => { Buffer.isBuffer(loc) && (loc = ut.unmakeLoc(loc)); const { address, port } = loc; port && sr.udp.send(mess, port, address) },

  recv: (mess, rinfo) => {
    if (rinfo.family !== 'IPv4') return

    const key = rinfo.address + ':' + rinfo.port
    sr.spam[key] ? ++sr.spam[key] : (sr.spam[key] = 1)
    if (sr.spam[key] === sr.spamLimit) go.doUpdate('spam', key)
    if (sr.spam[key] > sr.spamLimit) return

    try { mess = ben.decode(mess) } catch (err) { mess = null }
    if (!mess || !mess.y) return
    const y = mess.y.toString()
    if (y === 'q') iq.query(mess, rinfo) // incoming unsolicited query, response expected
    else if (y === 'r' || y === 'e') oq.resp(y, mess, rinfo) // incoming solicted response
  }
}

// my node
const my = {
  table: null,
  id: ut.random(ut.idLen),
  keyPair: eds.createKeyPair(ut.random(ut.keyLen)),
  bootLocs: Buffer.alloc(0),

  populate: () => { oq.populate(my.table, my.bootLocs, (numVisited) => { go.doUpdate('ready', numVisited); my.update() }) },

  refreshTable: () => {
    my.table.refreshTable(
      (loc) => { oq.query('ping', {}, loc, (r) => {}) },
      (loc) => { go.doUpdate('dropContact', ut.unmakeLoc(loc)) }
    )
    my.update()
  },

  update: () => {
    go.doUpdate('locs', Buffer.concat(my.table.allContacts().map((contact) => { return contact.loc })))
    go.doUpdate('closest', my.table.closestContacts().map((contact) => { return contact.id }))
  }
}

// public interface
const pi = {
  getPeers: (ih, done, onV) => { oq.act('get_peers', { info_hash: ih }, onV, null, null, done) },

  announcePeer: (ih, done, onV) => { oq.act('get_peers', { info_hash: ih }, onV, 'announce_peer', { info_hash: ih, port: sr.port, implied_port: 1 }, done) },

  getData: (target, mutableSalt, done, onV) => { oq.act('get', { target: target, mutableSalt: mutableSalt }, onV, null, null, done) },

  putData: (v, mutableSalt, target, done, onV) => { return oq.act('get', { target: target, mutableSalt: mutableSalt }, onV, 'put', { v: v }, done) }
}

// outgoing queries
const oq = {
  tCount: 0, // t (transaction id) counter
  waitingQueries: [], // remember query, loc, done for unsent queries
  pendingQueries: {}, // remember t (transaction id), ticks, and callback for each unanswered query
  pendingTick: 5, // number of ticks (of checkInterval) before unanswered query expires
  pendingMax: 20, // max number of unanswered queries
  checkInterval: 100, // every 100 ms check outgoing query buffers
  match: 4, // block contacts too close to table id (spam)

  check: () => {
    Object.entries(oq.pendingQueries).forEach(([t, obj]) => {
      if (--obj.tick <= 0) {
        const done = obj.done
        delete oq.pendingQueries[t]
        done(null)
      }
    })
    while (oq.waitingQueries.length > 0 && !oq.pendingBufferFull()) { const {q, a, loc, done} = oq.waitingQueries.shift(); oq.query(q, a, loc, done) }
  },

  pendingBufferFull: () => { return Object.keys(oq.pendingQueries).length >= oq.pendingMax },

  query: (q, a, loc, done) => { // outgoing query, response expected
    if (oq.pendingBufferFull()) {
      oq.waitingQueries.push({ q: q, a: a, loc: loc, done: done })
      return
    }
    a.id = my.id
    const mess = { t: ut.intToBuff2(oq.tCount), y: 'q', q: q, a: a }
    oq.pendingQueries[oq.tCount.toString()] = { tick: oq.pendingTick, done: done }
    ++oq.tCount > 65535 && (oq.tCount = 0)
    sr.send(ben.encode(mess), loc)
  },

  resp: (y, mess, rinfo) => {
    if (!mess.t) return
    if (!mess.t.length === 2 || !mess.r || !mess.r.id) return
    const t = ut.buff2ToInt(mess.t).toString()
    if (Object.keys(oq.pendingQueries).includes(t)) {
      ut.addContact(my.table, mess.r.id, ut.makeLoc(rinfo.address, rinfo.port))
      const done = oq.pendingQueries[t].done
      delete oq.pendingQueries[t]
      if (y === 'r') done(mess.r)
      else if (mess.e) {
        done(null)
        go.doUpdate('error', { e: mess.e, rinfo: rinfo })
      }
    }
  },

  populate: (table, locs, done) => {
    let visited = Buffer.alloc(0); let pending = 0
    const find = (loc) => {
      if (visited.indexOf(loc) >= 0) return
      visited = Buffer.concat([visited, loc])
      ++pending
      oq.query('find_node', { target: table.id }, loc, (res) => {
        if (res && res.id && res.id.length === ut.idLen && res.nodes && res.nodes.length % ut.nodeLen === 0) {
          ~~(res.nodes.length / ut.nodeLen) !== 16 && ut.addContact(table, res.id, loc) // don't add router.bittorrent.com
          const maxY = table.tree.length - 1
          const contacts = []
          ut.splitBuff(res.nodes, ut.nodeLen).forEach((node) => { const parts = ut.splitBuff(node, ut.idLen); contacts.push({ id: parts[0], loc: parts[1] }) })
          contacts
          .filter((contact) => { const { y } = table.findContact(contact.id); return y === maxY }) // would be in table tip node
          .forEach((contact) => { find(contact.loc) })
        }
        if (--pending > 0) return
        done(visited.length / ut.locLen)
      })
    }
    locs.forEach((loc) => { find(loc) })
    pending || done(visited.length / ut.locLen)
  },

  act: (pre, preArgs, onV, post, postArgs, done) => {
    let target
    pre === 'get_peers' && (target = preArgs.info_hash)
    pre === 'get' && (target = preArgs.target)
    let salt = null; let mutable = false
    preArgs.mutableSalt && (mutable = true)
    Buffer.isBuffer(preArgs.mutableSalt) && (salt = preArgs.salt)
    delete preArgs.mutableSalt
    let a = null
    if (post === 'put') {
      const v = postArgs.v
      a = { v: v }
      if (mutable) {
        salt && (a.salt = salt)
        if (!target) {
          a.seq = ~~(Date.now() / 1000) // unix time in seconds
          a.k = my.keyPair.publicKey
          a.sig = eds.sign(ut.packSeqSalt(a.seq, v, salt), my.keyPair.publicKey, my.keyPair.secretKey)
          target = ut.makeMutableTarget(a.k, salt)
        }
      } else {
        target = ut.makeImmutableTarget(v)
      }
    }
    const table = my.table.createTempTable(target)
    oq.populate(table, table.closestContacts().map((contact) => { return contact.loc }), (numVisited) => {
      let pending = 0; let unique = Buffer.alloc(); let peers = null; let numStored = 0; let numFound = 0; let value = null; let seq = 0

      const finish = () => {
        if (--pending > 0) return
        if (post) done(numVisited, numStored)
        else if (peers) done(numVisited, peers)
        else if (value !== null) done(numVisited, { v: value, seq: seq, numFound: numFound })
        else done(null, 0)
      }
      table.closestContacts().forEach((contact) => {
        ++pending
        oq.query(pre, preArgs, contact.loc, (res) => { // get values and token
          if (res) {
            if (res.v) { // get
              if (ben.encode(res.v).length > ut.maxV) { finish(); return }
              if (res.seq || res.k || res.sig) { // mutable
                if (!(res.seq && res.k && res.sig && res.k.length === ut.keyLen && res.sig.length === ut.sigLen)) { finish(); return }
                if (!target.equals(ut.makeMutableTarget(res.k, salt))) { finish(); return }
                if (!eds.verify(res.sig, ut.packSeqSalt(res.seq, res.v, salt), res.k)) { finish(); return }
                if (res.seq > seq) {
                  seq = res.seq
                  value = res.v
                  numFound = 1
                } else if (value && res.seq === value.seq) {
                  ++numFound
                }
              } else { // immutable
                if (!target.equals(ut.makeImmutableTarget(res.v))) { finish(); return }
                if (!value) value = res.v
                ++numFound
              }
              if (onV) onV(res, target)
            }
            if (res.values) {
              let err = null; res.values.forEach((peer) => { if (peer.length !== ut.locLen) err = true })
              if (err) { finish(); return }
              !peers || (peers = [])
              res.values.forEach((peer) => { if (!unique.includes(peer)) { unique = Buffer.concat([unique, peer]); peers.push(peer) } })
              if (onV) onV(res, target)
            }
            if (res.token && post) { // use token to store peers or data
              ++pending
              postArgs.token = res.token
              if (mutable) {
                postArgs.cas = res.seq
                if (!postArgs.k) {
                  postArgs.seq = res.seq
                  postArgs.k = res.k
                  postArgs.sig = res.sig
                }
              }
              oq.query(post, postArgs, contact.loc, (r) => { r && ++numStored; finish() })
            }
          }
          finish()
        })
      })
    })
    if (post === 'put') { a.target = target; return a }
  }
}

// incoming queries
const iq = {
  match: 2,
  secret: ut.random(ut.idLen),
  oldSecret: ut.random(ut.idLen),

  newSecret: () => { iq.oldSecret = iq.secret; iq.secret = ut.random(ut.idLen) },

  query: (mess, rinfo) => {
    const sendErr = (code, msg, tag, loc) => { sr.send(ben.encode({ t: tag, y: 'e', e: [code, msg] }), loc) }
    const contactsToNodes = (contacts) => {
      let nodes = []; let num = 0
      contacts.forEach((contact) => { nodes.push(contact.id, contact.loc); ++num })
      return Buffer.concat(nodes, num * ut.nodeLen)
    }
    const getNodes = (target) => { return contactsToNodes(my.table.createTempTable(target).closestContacts().slice(0, ut.numClosest)) }
    if (!mess.t) return
    const t = mess.t
    if (!mess.q || !mess.a) { sendErr(203, 'Protocol error', t, rinfo); return }
    const q = mess.q.toString()
    go.doUpdate('incoming', { q: q, rinfo: rinfo })
    const resp = { t: t, y: 'r', r: { id: my.id } }
    const a = mess.a
    if (!a.id || a.id.length !== ut.idLen) { sendErr(203, 'Protocol error', t, rinfo); return }
    let target = a.target || a.info_hash
    if (target && target.length !== ut.idLen) { sendErr(203, 'Protocol error', t, rinfo); return }
    if (!target && q !== 'put') { sendErr(203, 'Protocol error', t, rinfo); return }
    const contact = ut.addContact(my.table, a.id, ut.makeLoc(rinfo.address, rinfo.port))
    const node = contactsToNodes([contact])
    const token = ut.sha1(Buffer.concat([node, iq.secret]))
    const oldToken = ut.sha1(Buffer.concat([node, iq.oldSecret]))
    const validToken = a.token && (a.token.equals(token) || a.token.equals(oldToken))
    if (q === 'ping') ;
    else if (q === 'find_node') {
      resp.r.nodes = getNodes(a.target)
    } else if (q === 'get_peers') {
      resp.r.token = token
      const peers = ps.getPeers(target)
      peers ? (resp.r.values = peers) : (resp.r.nodes = getNodes(target))
    } else if (q === 'announce_peer') {
      if (!validToken) { sendErr(203, 'Protocol error', t, rinfo); return }
      if (!ut.byteMatch(target, my.id, iq.match)) return
      let peer
      if (!a.implied_port || a.implied_port !== 1) {
        if (!a.port) { sendErr(203, 'Missing port', t, rinfo); return }
        peer = ut.makeLoc(rinfo.address, a.port)
      } else peer = contact.loc
      ps.putPeer(target, peer)
    } else if (q === 'get') {
      resp.r.token = token
      const datum = ds.getData(a.target)
      datum && (a.seq ? datum.seq > a.seq : true) && Object.assign(resp.r, datum)
      resp.r.nodes = getNodes(a.target)
    } else if (q === 'put') {
      if (!validToken) { sendErr(203, 'Invalid token', t, rinfo); return }
      if (!a.v) { sendErr(203, 'Missing v', t, rinfo); return }
      if (ben.encode(a.v).length > ut.maxV) { sendErr(205, 'Message (v) too big', t, rinfo); return }
      let datum
      if (a.k && a.seq && a.sig) { // mutable
        if (a.k.length !== ut.keyLen || a.sig.length !== ut.sigLen) { sendErr(203, 'Protocol error', t, rinfo); return }
        if (!eds.verify(a.sig, ut.packSeqSalt(a.seq, a.v, a.salt), a.k)) { sendErr(206, 'Invalid signature', t, rinfo); return }
        target = a.k
        if (a.salt) {
          if (a.salt.length > ut.saltLen) { sendErr(207, 'Salt too big', t, rinfo); return }
          target = Buffer.concat([target, a.salt])
        }
        target = ut.sha1(target)
        const oldDatum = ds.getData(target)
        if (oldDatum) {
          if (a.hasOwnProperty('cas') && a.cas !== oldDatum.seq) { sendErr(301, 'CAS mismatch', t, rinfo); return }
          if (oldDatum.seq > a.seq) { sendErr(302, 'Sequence number too small', t, rinfo); return }
          if (oldDatum.seq === a.seq && !ben.encode(oldDatum.v).equals(ben.encode(a.v))) { sendErr(302, 'Sequence number too small', t, rinfo); return }
        }
        datum = { v: a.v, k: a.k, seq: a.seq, sig: a.sig }
      } else { // immutable
        target = ut.sha1(ben.encode(a.v))
        datum = { v: a.v }
      }
      if (!ut.byteMatch(target, my.id, iq.match)) return
      ds.putData(target, datum)
    } else return
    sr.send(ben.encode(resp), contact.loc)
  }
}

// peer storage
const ps = {
  peers: {},
  timeout: 30 * 60 * 1000, // 30 minutes
  peersLimit: 150,

  update: () => {
    let numPeers = 0
    const now = Date.now()
    Object.keys(ps.peers).forEach((ihHex) => {
      for (const [peerHex, time] of Object.entries(ps.peers[ihHex])) {
        if (now - time >= ps.timeout) {
          delete ps.peers[ihHex][peerHex]
          go.doUpdate('dropPeer', ut.unmakeLoc(ut.hexToBuff(peerHex)))
        } else {
          ++numPeers
        }
      }
      Object.keys(ps.peers[ihHex]).length === 0 && delete ps.peers[ihHex]
    })
    go.doUpdate('peers', { numPeers: numPeers, numInfohashes: Object.keys(ps.peers).length })
  },

  putPeer: (ih, peer) => {
    const ihHex = ut.buffToHex(ih)
    ps.getPeers(ih) || (ps.peers[ihHex] = {})
    ps.peers[ihHex][ut.buffToHex(peer)] = Date.now()
  },

  getPeers: (ih) => {
    const peers = ps.peers[ut.buffToHex(ih)]
    if (!peers) return peers
    return Object.keys(peers).map((peerHex) => { return ut.hexToBuff(peerHex) }).slice(0, ps.peersLimit)
  }
}

// data storage
const ds = {
  data: {},
  timeout: 120 * 60 * 1000, // 2 hours

  update: () => {
    const now = Date.now()
    Object.keys(ds.data).forEach((targetHex) => {
      if (now - ds.data[targetHex].time >= ds.timeout) {
        delete ds.data[targetHex]
        go.doUpdate('dropData', targetHex)
      }
    })
    go.doUpdate('data', Object.keys(ds.data).length)
  },

  putData: (target, data) => {
    data.time = Date.now()
    ds.data[ut.buffToHex(target)] = data
  },

  getData: (target) => {
    const data = { ...ds.data[ut.buffToHex(target)] }
    delete data.time
    return data
  }
}

module.exports = go.init
