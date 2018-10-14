module.exports = decode

const crypto = require('crypto')

function sha1 (buff) { return crypto.createHash('sha1').update(buff).digest() }

function decode (buff) {
  if (!Buffer.isBuffer(buff)) return null
  const len = buff.length
  let i = 0
  let info = null
  try { return { meta: next(), infoHash: (info ? sha1(info) : null) } } catch (err) { return null }

  function next () {
    const c = buff[i++]
    if (c === code('d')) return dictionary()
    if (c === code('l')) return list()
    if (c === code('i')) return integer()
    --i; return string()
  }

  function dictionary () {
    const dict = {}
    while (buff[i] !== code('e') && i < len) {
      const key = string()
      const start = i
      const val = next()
      dict[key] = val
      if (key.toString() === 'info') info = buff.slice(start, i)
    }
    if (i === len) throw 0
    ++i; return dict
  }

  function list () {
    const lst = []
    while (buff[i] !== code('e') && i < len) lst.push(next())
    if (i === len) throw 1
    ++i; return lst
  }

  function integer () {
    return toInteger(i, find(code('e')))
  }

  function string() {
    const end = toInteger(i, find(code(':'))) + i
    const start = i
    i = end; return buff.slice(start, end)
  }

  function code (str) { return str.charCodeAt(0) }

  function find (c) {
    while (i < len) { if (buff[i++] === c) return i - 1 }
    throw 2
  }

  function toInteger (start, end) {
    const int = parseInt(buff.toString('ascii', start, end))
    if (isNaN(int)) throw 3
    return int
  }
}
