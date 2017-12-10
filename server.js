#!/usr/bin/env node

// Syntax: server.js [server-port [bootstrap-location]]
//
//  server-port -- valid decimal port number (optional, default 6881)
//  boostrap-location -- address:port like router.utorrent.com:6881, or IPv4-address:port like 67.215.246.10:6881 (optional)
//
// Configuration files (in the current directory):
//
// idPath -- stores 20-byte table id; if absent, a random id is created and stored
// seedPath -- stores 32-byte seed for keyPair generation; if absent, a random seed is created and stored
// bootPath -- stores 6-byte network location * number of locations to boot from
//
// If server-port is 20-bytes or 32-bytes in hex form, then this program functions as a tool to update idPath or seedPath

const fs = require('fs')
const dns = require('dns')
const http = require('http')
const ben = require('bencode')
const eds = require('ed25519-supercop') // for random
const dhtInit = require('./mdht')

const idLen = 20; const seedLen = 32; const keyLen = 32; const locLen = 6
const idPath = '.id'; const seedPath = '.seed'; const bootPath = '.boot'
let dht, pKey; let port = 6881

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

const defaultBootLoc = 'router.bittorrent.com:6881' // alternate router.utorrent.com:6881
let bootLoc = bootPath

const opts = {}
const args = process.argv
args.shift(); args.shift()
let arg
arg = args.shift(); if (arg !== undefined) {
  const save = (hex, path) => {
    if (/^0-9a-fA-F/.test(hex)) return
    report('saving => ' + path)
    saveBuff(Buffer.from(hex, 'hex'), path)
    process.exit(1)
  }
  arg.length === idLen * 2 && save(arg, idPath)
  arg.length === seedLen * 2 && save(arg, seedPath)
  port = parseInt(arg, 10)
  ;(port > 0 && port < 65536) || report('invalid port => ' + port, true)
  opts.port = port
}
arg = args.shift(); if (arg !== undefined) bootLoc = arg

opts.id = loadOrRandom(idPath, idLen)
opts.seed = loadOrRandom(seedPath, seedLen)

if (bootLoc === '.boot') {
  const bootLocs = loadBuff(bootLoc)
  if (bootLocs) {
    report('booting from => .boot'); go(bootLocs)
  } else {
    report('booting from => ' + defaultBootLoc); toLoc(defaultBootLoc)
  }
} else {
  report('booting from => ' + bootLoc); toLoc(bootLoc)
}

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
  function addrPort (obj) { return obj.address + ':' + obj.port }
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
    let data = Buffer.alloc(0)
    req.on('data', (chunk) => { data = Buffer.concat([data, chunk]) })
    req.on('end', () => {
      try { data = ben.decode(data) } catch (err) { data = null }
      doAPI(data, (results) => { res.end(ben.encode(results)) })
    })
  }).listen(port, (err) => {
    if (err) { report('http server failed to start on port => ' + port, true) }
    report('http server is listening on port => ' + port)
  })
}

function doAPI (data, done) {
  if (!data || !data.method || !data.args) return
  const method = data.method.toString()
  const args = data.args
  let ih
  switch (method) {
    case 'announcePeer':
      ih = args.ih
      if (!ih || !Buffer.isBuffer(ih) || ih.length !== idLen) { noCall(); break }
      report('calling => ' + method)
      dht.announcePeer(ih, done)
      break
    case 'getPeers':
      ih = args.ih
      if (!ih || !Buffer.isBuffer(ih) || ih.length !== idLen) { noCall(); break }
      report('calling => ' + method)
      dht.getPeers(ih, done)
      break
    case 'putData':
      if (!args.hasOwnProperty('v') || !args.hasOwnProperty('mutableSalt')) { noCall(); break }
      const resetTarget = args.resetTarget
      if (resetTarget && (!Buffer.isBuffer(resetTarget) || resetTarget.length !== idLen)) { noCall(); break }
      report('calling => ' + method)
      dht.putData(args.v, args.mutableSalt, args.resetTarget, done)
      break
    case 'getData':
      if (!args.hasOwnProperty('mutableSalt')) { noCall(); break }
      const target = args.target
      if (!target || !Buffer.isBuffer(target) || target.length !== idLen) { noCall(); break }
      report('calling => ' + method)
      dht.getData(target, args.mutableSalt, done)
      break
    case 'makeMutableTarget':
      let k = args.k
      k || (k = pKey)
      if (!Buffer.isBuffer(k) || k.length !== keyLen) { noCall(); break }
      if (!args.hasOwnProperty('mutableSalt')) { noCall(); break }
      report('calling => ' + method)
      done(dht.makeMutableTarget(k, args.mutableSalt))
      break
    case 'makeImmutableTarget':
      if (!args.hasOwnProperty('v')) { noCall(); break }
      report('calling => ' + method)
      done(dht.makeImmutableTarget(args.v))
      break
    default:
      noCall()
  }
  function noCall () {
    report('not called => ' + method)
    done({})
  }
}
