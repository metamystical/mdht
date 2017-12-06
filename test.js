#!/usr/bin/env node

// Syntax: test.js [udp-server-port [bootstrap-location]]
//
//  udp-server-port -- valid decimal port number such as 6881 (optional)
//  boostrap-location -- address:port like router.utorrent.com:6881, or IPv4-address:port like 67.215.246.10:6881 (optional)
//
// Configuration files (in the current directory):
//
// idPath -- stores 20-byte table id; if absent, a random id is created and stored
// seedPath -- stores 32-byte seed for keyPair generation; if absent, a random seed is created and stored
// bootPath -- stores 6-byte network location * number of locations to boot from
//
// If udp-server-port is 20-bytes or 32-bytes in hex form, then this program functions as a tool to update idPath or seedPath

const fs = require('fs')
const dns = require('dns')
const eds = require('ed25519-supercop') // for random
const dhtInit = require('./mdht')

const idLen = 20; const seedLen = 32; const locLen = 6
const idPath = '.id'; const seedPath = '.seed'; const bootPath = '.boot'
let dht, pKey

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
    report('error reading from ' + path, true)
  }
}
function saveBuff (buff, path) {
  try {
    fs.writeFileSync(path, buff, { mode: 0o600 })
    return buff
  } catch (err) { report('error writing to ' + path, true) }
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
  opts.port = parseInt(arg, 10)
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
  if (parts.length !== 2 || !(parts[1] > 0 && parts[1] < 65536)) report('invalid address:port')
  else dns.lookup(parts[0], { family: 4 }, (err, address) => { err ? report('dns lookup error') : go(makeLoc(address, parts[1])) })
}

function go (loc) { opts.bootLocs = loc; dht = dhtInit(opts, update) }

function update (key, val) {
  function addrPort (obj) { return obj.address + ':' + obj.port }
  switch (key) {
    case 'udpFail': report('fatal error opening port => ' + val); process.exit(0)
    case 'id': report('id => ' + val.toString('hex')); break
    case 'publicKey': report('public key => ' + val.toString('hex')); pKey = val; break
    case 'listening': report('server listening on port => ' + val.port); break
    case 'ready': report('bootstrap complete, nodes visited => ' + val); next(); break
    case 'incoming': report('incoming => ' + val.q + ' (' + addrPort(val.rinfo) + ')'); break
    case 'error': report('error => ' + val.e[0] + ': ' + val.e[1] + ' (' + addrPort(val.rinfo) + ')'); break
    case 'locs': report('number of contacts => ' + (val.length / locLen) + ', saving to => .boot'); saveBuff(val, '.boot'); break
    case 'closest': report('closest contacts =>'); val.forEach((id) => { report(id.toString('hex')) }); break
    case 'peers': report('stored peers => ' + val.numPeers + ', infohashes => ' + val.numInfohashes); break
    case 'data': report('stored data => ' + val); break
    case 'spam': report('spammer => ' + val); break
    case 'dropNode': report('dropping node => ' + val); break
    case 'dropPeer': report('dropping peer => ' + val); break
    case 'dropData': report('dropping data @ target => ' + val); break
    case 'udpFail': report('fatal error opening port => ' + val); process.exit(0)
  }
}

function next () {
  // const ih = Buffer.from('3663c233ac0e1d329f538bab02128ba2c396467a', 'hex'); console.log('ih', ih.toString('hex'))
  // dht.announcePeer(ih, (numVisited, numAnnounced) => { console.log('visited:', numVisited, 'announced:', numAnnounced) })
  // dht.getPeers(ih, (numVisited, peers) => {
  //  console.log('nodes visited:', numVisited)
  //  if (peers) { console.log('=> peers', peers.length); peers.forEach((peer) => { console.log(peer.toString('hex')) }) }
  //  else console.log('=> no peers found')
  // })

  // const v = {m: 'JEB', f: 'MLK'}; let mutableSalt = false; let resetTarget = null
  // console.log('ret:', dht.putData(v, mutableSalt, resetTarget, (numVisited, numStored) => { console.log('put:', numVisited, numStored) }))
  // let target = dht.makeImmutableTarget(v); console.log('target', target.toString('hex'))
  // dht.getData(target, mutableSalt, (numVisited, value) => { console.log('get:', numVisited, value) })

  // mutableSalt = 'salt'
  // console.log(dht.putData(v, mutableSalt, resetTarget, (numVisited, numStored) => { console.log('put:', numVisited, numStored) }))
  // target = dht.makeMutableTarget(pKey, mutableSalt); console.log('target', target.toString('hex'))
  // dht.getData(target, mutableSalt, (numVisited, value) => { console.log('get:', numVisited, value) })

  // resetTarget = target
  // console.log(dht.putData(v, mutableSalt, resetTarget, (numVisited, numStored) => { console.log('put:', numVisited, numStored) }))
}
