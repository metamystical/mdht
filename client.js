// client.js -- makes requests to server.js

const DEFAULT_PORT = 6881

const http = require('http')

const client = {
  serverPort: DEFAULT_PORT,

  init: (port) => {
    client.serverPort = port
  },

  announcePeer: (ih, next) => {
    request({ method: 'announcePeer', args: { ih: ih } }, next)
  },

  getPeers: (ih, next) => {
    request({ method: 'getPeers', args: { ih: ih } }, next)
  },

  putData: (v, mutableSalt, resetTarget, next) => {
    request({ method: 'putData', args: { v: v, mutableSalt: mutableSalt, resetTarget: resetTarget } }, next)
  },

  getData: (target, mutableSalt, next) => {
    request({ method: 'getData', args: { target: target, mutableSalt: mutableSalt } }, next)
  },

  makeMutableTarget: (k, mutableSalt, next) => {
    request({ method: 'makeMutableTarget', args: { k: k, mutableSalt: mutableSalt } }, next)
  },

  makeImmutableTarget: (v, next) => {
    request({ method: 'makeImmutableTarget', args: { v: v } }, next)
  }
}

function request (data, done) {
  const post = JSON.stringify(data)
  http.request(
    {
      hostname: 'localhost',
      port: client.serverPort,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': post.length
      }
    },
    (res) => {
      let data = Buffer.alloc(0)
      res.on('data', (chunk) => { data = Buffer.concat([data, chunk]) })
      res.on('end', () => {
        data = JSON.parse(data)
        walk(data)
        done(data)
      })
    }
  ).end(post).on('error', (err) => { done(null) })
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

module.exports = client
