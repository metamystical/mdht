// Syntax:
//
// const dhtInit = require('./mdht')
// const dht = dhtInit(opts, update)
//
//  opts.port -- UDP server port (integer, default 6881)
//  opts.id -- my node id (20-byte buffer, default random)
//  opts.seed -- seed for generating ed25519 key pair for signing mutable data (32-byte buffer, default random)
//  opts.bootLocs -- locations to contact at startup (buffer of concatenated 6-byte network locations, default empty)
//
//  update -- function to signal the calling program, called with two arguments update(key, val)
//   key -- type of signal (string)
//   val -- data structure (type depends on key)
//
// dhtInit returns an object with the following methods:
//
//  dht.announcePeer(ih, (numVisited, numAnnounced) => {})
//  dht.getPeers(ih, (peers, numVisited) => {})
//  dht.putData(v, salt, mutable, reset, (numVisited, numStored) => {})
//  dht.getData(target, salt, (v, seq, numVisited, numFound) => {})
//  dht.makeSalt(str | buff) // returns a valid salt buffer <= ut.saltLen, given a string or buffer
//  dht.makeMutableTarget(k, salt) // returns a mutable target
//  dht.makeImmutableTarget(v) // returns an Immutable target
//
//   ih -- infohash of a torrent (20-byte buffer)
//   target -- id of data stored in the DHT (20-byte buffer)
//   v -- value stored in the DHT by putData and returned by getData (object, buffer, string or number)
//   salt -- if not null, used to vary the target of mutable data for a given public key (<= 64-byte buffer)
//   mutable -- true if mutable data, false if immutable (boolean)
//   reset -- if not null, a target (possibly obtained from elsewhere along with salt) to reset the timeout of previously stored mutable data
//   k -- public key (32-byte buffer)
//
// Terminolgy:
//
// location (loc) -- 6-byte network location buffer (4-byte IPv4 address + 2-byte port)
// node -- 26-byte buffer (20-byte id + 6-byte location); identfies and locates a DHT node (UDP)
// contact -- object version of a node {id: 20-byte buffer, loc: 6-byte location bufer}, where id is a DHT node id or a torrent infohash
// peer -- 6-byte location of a mainlne bittorrent client (TCP) that includes a DHT node, not always having the same port as its node

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
    sr.udp.on('message', (data, rinfo) => { process.nextTick(sr.recv, data, rinfo) })
  },

  spamReset: () => { sr.spam = {} },

  send: (message, loc) => { const { address, port } = ut.unmakeLoc(loc); port && sr.udp.send(message, port, address) },

  recv: (data, rinfo) => {
    if (rinfo.family !== 'IPv4') return

    const key = rinfo.address + ':' + rinfo.port
    sr.spam[key] ? ++sr.spam[key] : (sr.spam[key] = 1)
    if (sr.spam[key] === sr.spamLimit) go.doUpdate('spam', key)
    if (sr.spam[key] > sr.spamLimit) return

    try { data = ben.decode(data) } catch (err) { data = null }
    if (!data || !data.y) return
    const y = data.y.toString()
    if (y === 'q') iq.query(data, rinfo) // incoming unsolicited query, response expected
    else if (y === 'r') oq.resp(data, rinfo) // incoming solicted response
    else if (y === 'e' && data.e) go.doUpdate('error', { e: data.e, rinfo: rinfo }) // incoming error
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
  getPeers: (ih, done, onV) => {
    oq.act(ih, 'get_peers', { info_hash: ih }, onV, null, null, (data, numVisited) => {
      let unique = Buffer.alloc(0); let peers = []
      data.forEach((res) => {
        if (!res.values) return
        res.values.forEach((peer) => { if (!unique.includes(peer)) { unique = Buffer.concat([unique, peer]); peers.push(peer) } })
      })
      done(peers, numVisited)
    })
  },

  announcePeer: (ih, done, onV) => {
    oq.act(ih, 'get_peers', { info_hash: ih }, onV, 'announce_peer', { info_hash: ih, port: sr.port, implied_port: 1 }, done)
  },

  getData: (target, salt, done, onV) => {
    oq.act(target, 'get', { target: target }, onV, null, null, (results, numVisited) => {
      let numFound = 0; let result = null; let seq = 0
      results.forEach((res) => {
        if (!res.v) return
        if (res.seq || res.k || res.sig) { // mutable
          if (!(res.seq && res.k && res.sig && res.k.length === ut.keyLen && res.sig.length === ut.sigLen)) return
          if (!target.equals(ut.makeMutableTarget(res.k, salt))) return
          if (!eds.verify(res.sig, ut.packSeqSalt(res.seq, res.v, salt), res.k)) return
          if (res.seq > seq) {
            seq = res.seq
            result = res
            numFound = 1
          } else if (result && res.seq === result.seq) {
            ++numFound
          }
        } else { // immutable
          if (!target.equals(ut.makeImmutableTarget(res.v))) return
          if (!result) result = res
          ++numFound
        }
      })
      done(result ? result.v : null, result ? result.seq : 0, numVisited, numFound)
    })
  },

  putData: (v, salt, mutable, reset, done, onV) => {
    const a = { v: v }
    let target
    if (mutable) {
      a.mutable = true
      salt && (a.salt = salt)
      if (reset) {
        target = reset
      } else {
        a.seq = ~~(Date.now() / 1000) // unix time in seconds
        a.k = my.keyPair.publicKey
        a.sig = eds.sign(ut.packSeqSalt(a.seq, v, salt), my.keyPair.publicKey, my.keyPair.secretKey)
        target = ut.makeMutableTarget(a.k, salt)
      }
    } else {
      target = ut.makeImmutableTarget(v)
    }
    oq.act(target, 'get', { target: target }, onV, 'put', a, done)
    return a
  }
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

  resp: (data, rinfo) => {
    if (!data.t || !data.t.length === 2 || !data.r || !data.r.id) return
    const t = ut.buff2ToInt(data.t).toString()
    if (Object.keys(oq.pendingQueries).includes(t)) {
      ut.addContact(my.table, data.r.id, ut.makeLoc(rinfo.address, rinfo.port))
      const done = oq.pendingQueries[t].done
      delete oq.pendingQueries[t]
      done(data.r)
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

  act: (target, pre, preArgs, onV, post, postArgs, done) => {
    const table = my.table.createTempTable(target)
    oq.populate(table, table.closestContacts().map((contact) => { return contact.loc }), (numVisited) => {
      let pending = 0; let data = []; let numStored = 0
      const finish = () => {
        if (--pending > 0) return
        post ? done(numVisited, numStored) : done(data, numVisited)
      }
      table.closestContacts().forEach((contact) => {
        ++pending
        oq.query(pre, preArgs, contact.loc, (res) => { // get values and token
          if (res) {
            if (res.v || res.values) {
              data.push(res)
              onV && onV(res, target)
            }
            if (res.token && post) { // use token to store peers or data
              ++pending
              postArgs.token = res.token
              if (postArgs.mutable) {
                delete postArgs.mutable
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
  }
}

// incoming queries
const iq = {
  match: 2,
  secret: ut.random(ut.idLen),
  oldSecret: ut.random(ut.idLen),

  newSecret: () => { iq.oldSecret = iq.secret; iq.secret = ut.random(ut.idLen) },

  query: (data, rinfo) => {
    const contactsToNodes = (contacts) => {
      let nodes = []; let num = 0
      contacts.forEach((contact) => { nodes.push(contact.id, contact.loc); ++num })
      return Buffer.concat(nodes, num * ut.nodeLen)
    }
    const getNodes = (target) => { return contactsToNodes(my.table.createTempTable(target).closestContacts().slice(0, ut.numClosest)) }
    const sendErr = (code, msg) => { sr.send(ben.encode({ t: data.t, y: 'e', e: [code, msg] }), contact.loc) }
    if (!data.t || !data.q || !data.a) return
    const q = data.q.toString()
    go.doUpdate('incoming', { q: q, rinfo: rinfo })
    const resp = { t: data.t, y: 'r', r: { id: my.id } }
    const a = data.a
    if (!a.id || a.id.length !== ut.idLen) return
    let target = a.target || a.info_hash
    if (target && target.length !== ut.idLen) return
    if (!target && q !== 'put') return
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
      if (!validToken || !ut.byteMatch(target, my.id, iq.match)) return
      let peer
      if (!a.implied_port || a.implied_port !== 1) {
        if (!a.port) return
        peer = ut.makeLoc(rinfo.address, a.port)
      } else peer = contact.loc
      ps.putPeer(target, peer)
    } else if (q === 'get') {
      resp.r.token = token
      const datum = ds.getData(a.target)
      datum && (a.seq ? datum.seq > a.seq : true) && Object.assign(resp.r, datum)
      resp.r.nodes = getNodes(a.target)
    } else if (q === 'put') {
      if (!validToken || !a.v || a.v.length > 1000) return
      let datum
      if (a.k && a.seq && a.sig) { // mutable
        if (a.k.length !== ut.keyLen || a.sig.length !== ut.sigLen) return
        if (!eds.verify(a.sig, ut.packSeqSalt(a.seq, a.v, a.salt), a.k)) return
        target = a.k
        if (a.salt) {
          if (a.salt.length > ut.saltLen) return
          target = Buffer.concat([target, a.salt])
        }
        target = ut.sha1(target)
        const oldDatum = ds.getData(target)
        if (oldDatum) {
          if (a.hasOwnProperty('cas') && a.cas !== oldDatum.seq) { sendErr(301, 'Invalid CAS'); return }
          if (oldDatum.seq > a.seq) return
          if (oldDatum.seq === a.seq && !ben.encode(oldDatum.v).equals(ben.encode(a.v))) return
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

// err messages?
