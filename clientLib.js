function checkHex(hex) {
  if (/[^0-9a-fA-F]/.test(hex) || hex.length != 40) return ''
  return hex
}

function hexToString(hex) {
  let str = ''
  for (let i = 0; i < hex.length; i += 2) { str += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16)) }
  return str
}

function BuffToHex (obj) { // recursively walk through object, converting { type: 'Buffer', data: array of integers } to hex string
  for (const k in obj) {
    if (obj.hasOwnProperty(k)) {
      const v = obj[k]
      if (v && v.type === 'Buffer' && Array.isArray(v.data)) {
        obj[k] = v.data.map((i) => { let hex = i.toString(16); hex.length === 2 || (hex = '0' + hex); return hex }).join('')
      } else if (!Array.isArray(obj) && typeof obj !== 'string') BuffToHex(obj[k])
    }
  }
}

function hexToBuff(hex) { // convert hex string to { type: 'Buffer', data: array of integers }
  const a = []
  for (let i = 0; i < 40; i += 2) a.push(parseInt(hex.slice(i, i + 2), 16))
  return { type: 'Buffer', data: a }
}

let url = ''

function query (req, done) {
  fetch(url, { method: 'POST', body: JSON.stringify(req), headers: { 'Content-Type': 'application/json' } })
  .then((res) => { if (!res.ok) throw 'Network error'; return res.json() })
  .then((res) => { BuffToHex(res); done(res) })
  .catch ((err) => { done(null) })
}
