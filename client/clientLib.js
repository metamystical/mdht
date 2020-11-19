// mdht client library, usable in node.js or browser

const isNodeJS = (typeof module !== 'undefined' && module.exports)
let http
if (isNodeJS) http = require('http')

const cl = {
  url: '', // default, send request to server that served page
  port: 6881, // default

  // To send a command to mdht via the server, call the "cl.request" function below with
  // with the "req" argument in the form { method: '...', args: { ... } }
  //
  // mdht will respond via the callback function "next".
  //
  // A list of methods and their associated arguments is in the README.md file.
  //
  // Get BEP44 data example:
  //
  // const req = { method: 'getData', args: { mutableSalt: true } }
  // req.args.target = cl.hexToBuff('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
  // cl.request(req, (res) => { console.log(res.numVisited, res.numFound, res.v, res.seq } })
  //
  // Any argument value that is expected to be a node.js buffer by mdht must be
  // in the form: { type: 'Buffer', data: array of integers }
  // The function "cl.hexToBuff" below converts a hex string to this form.

  request: (req, next) => { // browser version
    fetch(cl.url, { method: 'POST', body: JSON.stringify(req), headers: { 'Content-Type': 'application/json' } })
    .then((res) => { if (!res.ok) throw ''; return res.json() })
    .then((res) => { next(cl.buffToHex(res)) })
    .catch ((err) => { console.log(err); next(null) })
  },

  checkHex: (hex) => { // check for 40 hex digits
    if (/[^0-9a-fA-F]/.test(hex) || hex.length != 40) return ''
    return hex
  },

  hexToString: (hex) => {
    let str = ''
    for (let i = 0; i < hex.length; i += 2) { str += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16)) }
    return str
  },

  buffToHex: (obj) => { // recursively walk through object, converting { type: 'Buffer', data: array of integers } to hex string
    if (obj && obj.type === 'Buffer' && Array.isArray(obj.data)) {
      return obj.data.map((i) => { let hex = i.toString(16); hex.length === 2 || (hex = '0' + hex); return hex }).join('')
    }
    else {
      Object.keys(obj).forEach((k) => { if( typeof obj[k] !== 'string') obj[k] = cl.buffToHex(obj[k]) })
      return obj
    }
  },

  hexToBuff: (hex) => { // convert hex string to { type: 'Buffer', data: array of integers }
    const a = []
    for (let i = 0; i < hex.length; i += 2) a.push(parseInt(hex.slice(i, i + 2), 16))
    return { type: 'Buffer', data: a }
  }
}

if (isNodeJS) cl.request = (req, next) => { // node.js version
  const post = JSON.stringify(req)
  http.request(
    {
      hostname: 'localhost',
      port: cl.port,
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
        next(cl.buffToHex(data))
      })
    }
  ).end(post).on('error', (err) => { console.log(err); next(null) })
}

if (isNodeJS) module.exports = cl
