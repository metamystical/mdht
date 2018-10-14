module.exports = encode

function encode (data) {
  const buffs = []
  convert(data)
  return Buffer.concat(buffs)

  function convert (d) {
    if (d == null) return
    if (Buffer.isBuffer(d)) buffer(d)
    else if (Array.isArray(d)) list(d)
    else if (Number.isInteger(d)) integer(d)
    else if (typeof d === 'string') buffer(Buffer.from(d)) // utf8
    else if (typeof d === 'object') dict(d)
  }

  function buffer (b) {
    buffs.push(Buffer.from(b.length + ':'), b)
  }

  function list (l) {
    buffs.push(Buffer.from('l'))
    l.forEach((e) => { convert(e) })
    buffs.push(Buffer.from('e'))
  }

  function integer (n) {
    buffs.push(Buffer.from('i' + n + 'e'))
  }

  function dict (d) {
    buffs.push(Buffer.from('d'))
    Object.keys(d).sort().forEach((k) => {
      const v = d[k]
      if (v == null) return
      buffer(Buffer.from(k))
      convert(v)
    })
    buffs.push(Buffer.from('e'))
  }
}
