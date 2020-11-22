#!/usr/bin/env node

// Syntax: server.js [server-port [bootstrap-location]]
//
//  server-port -- valid decimal port number (optional, default 6881)
//  boostrap-location -- address:port like router.utorrent.com:6881, or IPv4-address:port like 67.215.246.10:6881
//    (optional, default router.bittorrent.com:6881; only used when bootPath file is missing)
//
// Configuration files (in the current directory):
//
// seedPath -- stores 32-byte seed for keyPair generation; if absent, a random seed is created and stored
// bootPath -- stores 6-byte network location * number of locations to boot from
//
// If server-port is 32-bytes in hex form, then this program functions as a tool to update seedPath
//
// HTTP server uses JSON. If a response includes a Node.js Buffer, the Buffer is converted to
// an object: { type: 'Buffer', data: array of integers } and must be interpreted as such by clients.
// When making a request, clients should send objects in this form when a Buffer is required by mdht.

const fs = require('fs')
const dns = require('dns')
const url = require('url')
const http = require('http')
const https = require('https')
const eds = require('ed25519-supercop') // for random
const dhtInit = require('./mdht')

const idLen = 20; const seedLen = 32; const keyLen = 32; const locLen = 6
const seedPath = '.seed'; const bootPath = '.boot'
const defaultBootLoc = 'router.bittorrent.com:6881' // alternate router.utorrent.com:6881
const defaultPort = 6881
let port = defaultPort
let dht; let pKey;

const htmljs = { }
const files = ['menu.html', 'BEP44.html', 'announce.html', '404.html', 'clientLib.js']
files.forEach((file) => {
  const path = require.resolve('./client/' + file)
  const buff = loadBuff(path)
  if (!buff) report('error loading file => ' + file, true)
  htmljs[file] = buff.toString()
})
report('client files loaded')

let bootLoc = bootPath
const opts = {}
const args = process.argv
args.shift(); args.shift()
let arg
arg = args.shift(); if (arg !== undefined) {
  const save = (hex, path) => {
    if (/[^0-9a-fA-F]/.test(hex)) return
    report('saving => ' + path)
    saveBuff(Buffer.from(hex, 'hex'), path)
    process.exit(1)
  }
  arg.length === seedLen * 2 && save(arg, seedPath)
  port = parseInt(arg, 10)
  ;(port > 0 && port < 65536) || report('invalid port => ' + port, true)
  opts.port = port
}
arg = args.shift(); if (arg !== undefined) bootLoc = arg

opts.seed = loadOrRandom(seedPath, seedLen)

https.get('https://api.myip.com', (res) => {
  let data = Buffer.alloc(0)
  res.on('data', (chunk) => { data = Buffer.concat([ data, chunk] ) })
  res.on('end', () => { next(JSON.parse(data).ip) })
}).on('error', (err) => { next() })

function next (ip) {
  const rep = 'external ip request => '
  if (ip) {
    opts.ip = ip
    report(rep + ip) // compute BEP42 node id in mdht.js
  }
  else report(rep + 'failed') // use default random node id
  setImmediate(boot)
}

function boot () {
  if (bootLoc === bootPath) {
    const bootLocs = loadBuff(bootLoc)
    if (bootLocs) {
      report('booting from => .boot'); go(bootLocs)
    } else {
      report('booting from => ' + defaultBootLoc); toLoc(defaultBootLoc)
    }
  } else {
    report('booting from => ' + bootLoc); toLoc(bootLoc)
  }
}

function report (mess, err) {
  console.log('%s: %s', timeStr(Date.now()), mess)
  if (err) process.exit(1)
}

function timeStr (time) {
  const date = (new Date(time)).toJSON()
  return date.slice(0, 10) + ' ' + date.slice(11, 19) + ' UTC'
}

function loadBuff (path) {
  try {
    return fs.readFileSync(path)
  } catch (err) {
    if (err.code === 'ENOENT') return null // file missing
    report('error reading from => ' + path, true)
  }
}

function saveBuff (buff, path) {
  try {
    fs.writeFileSync(path, buff, { mode: 0o600 })
    return buff
  } catch (err) { report('error writing to => ' + path, true) }
}

function loadOrRandom (path, len) { return (loadBuff(path) || saveBuff(eds.createSeed().slice(0, len), path)) }

function toLoc (str) { // converts 'address:port' to 6-byte hex buffer, where address is an IPv4 address or a domain
  function makeLoc (address, port) {
    const arr = []
    address.split('.').forEach((dec) => { arr.push(parseInt(dec, 10)) })
    arr.push(port >>> 8, port & 0xff)
    return Buffer.from(arr)
  }
  const parts = str.split(':')
  if (parts.length !== 2 || !(parts[1] > 0 && parts[1] < 65536)) report('invalid address:port => ' + str, true)
  else dns.lookup(parts[0], { family: 4 }, (err, address) => { err ? report('dns lookup error => ' + parts[0], true) : go(makeLoc(address, parts[1])) })
}

function go (loc) { opts.bootLocs = loc; dht = dhtInit(opts, update) }

function update (key, val) {
  function addrPort (obj) { return (obj.bep42 ? '' : '*') + obj.address + ':' + obj.port }
  switch (key) {
    case 'udpFail': report('fatal error opening port => ' + val, true); break
    case 'id': report('id => ' + val.toString('hex')); break
    case 'publicKey': report('public key => ' + val.toString('hex')); pKey = val; break
    case 'listening': report('udp server listening on port => ' + val.port); break
    case 'ready': report('bootstrap complete, nodes visited => ' + val); server(); break
    case 'incoming': report('incoming => ' + val.q + ' (' + addrPort(val.socket) + ')'); break
    case 'error': report('error => ' + val.e[0] + ': ' + val.e[1] + ' (' + addrPort(val.socket) + ')'); break
    case 'nodes': report('number of contacts => ' + (val.length / locLen) + ', saving to => .boot'); saveBuff(val, '.boot'); break
    case 'closest': report('closest contacts =>'); val.forEach((id) => { report(id.toString('hex')) }); break
    case 'peers': report('stored peers => ' + val.numPeers + ', infohashes => ' + val.numInfohashes); break
    case 'data': report('stored data => ' + val); break
    case 'spam': report('spammer => ' + val); break
    case 'dropNode': report('dropping node => ' + val); break
    case 'dropPeer': report('dropping peer => ' + val); break
    case 'dropData': report('dropping data @ target => ' + val); break
  }
}

function server () {
  http.createServer((req, res) => {
    // the next two headers allow clients not served by GET requests to bypass CORS
    // this eliminates the need to keep restarting this server during client development
    // comment out the two headers if you want CORS restrictions
    res.setHeader('Access-Control-Allow-Origin', '*') 
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    switch (req.method) {
      case 'GET':
        switch (url.parse(req.url).pathname) {
          case '/': res.end(htmljs['menu.html']); break
          case '/BEP44.html': res.end(htmljs['BEP44.html']); break
          case '/announce.html': res.end(htmljs['announce.html']); break
          case '/clientLib.js': res.end(htmljs['clientLib.js']); break
          default: res.end(htmljs['404.html'])
        }
        break
      case 'POST':
        let data = Buffer.alloc(0)
        req.on('data', (chunk) => { data = Buffer.concat([data, chunk]) })
        req.on('end', () => {
          try {
            data = toBuff(JSON.parse(data))
            doAPI(data, (results) => { res.end(JSON.stringify(results)) })
          } catch (err) {
            res.end('')
          }
        })
        break
      default:
        res.end('')
        break
    }
  }).listen(port, (err) => {
    if (err) { report('http server failed to start on port => ' + port, true) }
    report('http server is listening on port => ' + port)
  })
}

function toBuff (obj) { // recursively walk through object, converting { type: 'Buffer', data: array of integers } to buffer
  if (obj && obj.type === 'Buffer' && Array.isArray(obj.data)) {
    return Buffer.from(obj.data.map((i) => { let hex = i.toString(16); hex.length === 2 || (hex = '0' + hex); return hex }).join(''), 'hex')
  }
  else {
    for (const [k, v] of Object.entries(obj)) { if (v !== null && v !== undefined && typeof v !== 'string') obj[k] = toBuff(v) }
    return obj
  }
}

function doAPI (data, done) {
  if (!data || !data.method || !data.args) return
  const method = data.method.toString()
  const args = data.args
  const target = args.ih || args.target || args.resetTarget
  let k = args.k
  k || (k = pKey)
  if (
    (!Buffer.isBuffer(k) || k.length !== keyLen) ||
    (target && (!Buffer.isBuffer(target) || target.length !== idLen)) ||
    ((method === 'announcePeer' || method === 'getPeers' || method === 'getData') && !target) ||
    ((method === 'putData' || method === 'makeImmutableTarget') && !args.hasOwnProperty('v'))
  ) done({})
  else {
    report('outgoing => ' + method)
    switch (method) {
      case 'announcePeer': dht[method](target, args.impliedPort, done); break
      case 'getPeers': dht[method](target, done); break
      case 'putData': dht[method](args.v, args.mutableSalt, target, done); break
      case 'getData': dht[method](target, args.mutableSalt, done); break
      case 'makeMutableTarget': done(dht[method](k, args.mutableSalt)); break
      case 'makeImmutableTarget': done(dht[method](args.v)); break
    }
  }
}
