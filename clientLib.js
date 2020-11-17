// mdht client library, usable in node.js or browser

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

const cl = {
  url: '',

  request: (req, next) => {
    fetch(cl.url, { method: 'POST', body: JSON.stringify(req), headers: { 'Content-Type': 'application/json' } })
    .then((res) => { if (!res.ok) throw ''; return res.json() })
    .then((res) => { cl.BuffToHex(res); next(res) })
    .catch ((err) => { next(null) })
  },

  checkHex: (hex) => {
    if (/[^0-9a-fA-F]/.test(hex) || hex.length != 40) return ''
    return hex
  },

  hexToString: (hex) => {
    let str = ''
    for (let i = 0; i < hex.length; i += 2) { str += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16)) }
    return str
  },

  BuffToHex: (obj) => { // recursively walk through object, converting { type: 'Buffer', data: array of integers } to hex string
    for (const k in obj) {
      if (obj.hasOwnProperty(k)) {
        const v = obj[k]
        if (v && v.type === 'Buffer' && Array.isArray(v.data)) {
          obj[k] = v.data.map((i) => { let hex = i.toString(16); hex.length === 2 || (hex = '0' + hex); return hex }).join('')
        } else if (!Array.isArray(obj) && typeof obj !== 'string') cl.BuffToHex(obj[k])
      }
    }
  },

  hexToBuff: (hex) => { // convert hex string to { type: 'Buffer', data: array of integers }
    const a = []
    for (let i = 0; i < 40; i += 2) a.push(parseInt(hex.slice(i, i + 2), 16))
    return { type: 'Buffer', data: a }
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = cl
