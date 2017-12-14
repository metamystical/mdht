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
    if (/[^0-9a-fA-F]/.test(hex)) return
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
    switch (req.method) {
      case 'GET':
        res.end(client())
        break
      case 'POST':
        let data = Buffer.alloc(0)
        req.on('data', (chunk) => { data = Buffer.concat([data, chunk]) })
        req.on('end', () => {
          try {
            doAPI(ben.decode(data), (results) => { res.end(ben.encode(results)) })
          } catch (err) {
            try {
              data = JSON.parse(data)
              walk(data)
              doAPI(data, (results) => { res.end(JSON.stringify(results)) })
            } catch (err) {
              res.end('')
            }
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

function walk (obj) { // recursively walk through object, converting { type: 'Buffer', data: array of integers } to buffer
  for (const k in obj) {
    if (obj.hasOwnProperty(k)) {
      const v = obj[k]
      if (v && v.type === 'Buffer' && Array.isArray(v.data)) {
        obj[k] = Buffer.from(v.data.map((i) => { let hex = i.toString(16); hex.length === 2 || (hex = '0' + hex); return hex }).join(''), 'hex')
      } else if (!Array.isArray(obj) && typeof obj !== 'string' && !Buffer.isBuffer(obj)) walk(obj[k])
    }
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
    (target !== undefined && (!Buffer.isBuffer(target) || target.length !== idLen)) ||
    ((method === 'announcePeer' || method === 'getPeers' || method === 'getData') && !target) ||
    ((method === 'putData' || method === 'makeImmutableTarget') && !args.hasOwnProperty('v'))
  ) {
    report('not calling => ' + method); done({})
  } else {
    report('calling => ' + method)
    if (method === 'announcePeer' || method === 'getPeers') dht[method](target, done)
    else if (method === 'putData') dht[method](args.v, args.mutableSalt, target, done)
    else if (method === 'getData') dht[method](target, args.mutableSalt, done)
    else if (method === 'makeMutableTarget') done(dht[method](k, args.mutableSalt))
    else if (method === 'makeImmutableTarget') done(dht[method](args.v))
  }
}

function client () {
  return `<!doctype html>
<html>
<head>
  <title>MDHT BEP44 client</title>
  <script src="http://code.jquery.com/jquery-3.2.1.min.js"></script>
  <script>
  $(document).ready(function() {
    const req = { }
    function query (request, done) { $.post('http://localhost:${port}', JSON.stringify(request), (data) => { walk(data); done(data) }, 'json') }
    $('#put').click(function (event) {
      req.method = 'putData'; req.args = {}
      const v = $('#v').val()
      if (v === '') return
      req.args.v = v; req.args.mutableSalt = mutableSalt()
      query(req, function (data) {
        data.target && $('#target').val(data.target)
        delete data.target; delete data.v; delete data.k; delete data.sig; delete data.salt
        $('#puts').text(report(data))
      })
    })
    $('#get').click(function (event) {
      req.method = 'getData'; req.args = {}
      const target = checkHex($('#target').val())
      if (target === '') return
      req.args.target = hexToBuff(target); req.args.mutableSalt = mutableSalt()
      query(req, function (data) {
        data.v && $('#v').val(hexToString(data.v))
        delete data.v
        $('#gets').text(report(data))
      })
    })
    function mutableSalt () {
      const mutable = $('#mutable').prop('checked')
      const salt = $('#salt').val()
      if (mutable && salt !== '') return salt
      return mutable
    }
    function report (obj) { return Object.entries(obj).map(([k, v]) => { return k + ': ' + v }).join(', ') }
    function hexToString(hex) {
      let str = ''
      for (let i = 0; i < hex.length; i += 2) { str += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16)) }
      return str
    }
    function checkHex(hex) {
      if (/[^0-9a-fA-F]/.test(hex) || hex.length != 40) { alert('Enter 40 hex'); return '' }
      return hex
    }
    function hexToBuff(hex) {
      const a = []
      for (let i = 0; i < 40; i += 2) a.push(parseInt(hex.slice(i, i + 2), 16))
      return { type: 'Buffer', data: a }
    }
    function walk (obj) { // recursively walk through object, converting { type: 'Buffer', data: array of integers } to hex string
      for (const k in obj) {
        if (obj.hasOwnProperty(k)) {
          const v = obj[k]
          if (v && v.type === 'Buffer' && Array.isArray(v.data)) {
            obj[k] = v.data.map((i) => { let hex = i.toString(16); hex.length === 2 || (hex = '0' + hex); return hex }).join('')
          } else if (!Array.isArray(obj) && typeof obj !== 'string') walk(obj[k])
        }
      }
    }
  })
  </script>
</head>
<body>
  <p>Mutable: <input type="checkbox" id="mutable"></p>
  <p>Salt: <input type="text" id="salt" size="30"></p>
  <table>
    <tr>
      <th>Data</th><th>Target</th>
    </tr><tr>
      <td><textarea id="v" cols="40" rows="5">One for all</textarea></td>
      <td><input type="text" id="target" maxlength="40" size="40"></td>
    </tr><tr>
      <td><input type = "button" id = "put" value = "Put data"></td>
      <td><input type = "button" id = "get" value = "Get data"></td>
    </tr><tr>
      <td><span id = "puts"></span></td>
      <td><span id = "gets"></span></td>
    </tr>
  </table>
</body>
</html>
`
}
