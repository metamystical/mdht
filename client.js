const http = require('http')
const ben = require('bencode')

const dump = (data) => { console.log(data) }

const ih = Buffer.from('3663c233ac0e1d329f538bab02128ba2c396467a', 'hex')
// request(ben.encode({ method: 'announcePeer', args: { ih: ih } }), dump)
// request(ben.encode({ method: 'getPeers', args: { ih: ih } }), dump)

const v = {m: 'JEB', f: 'MLK'}
// request(ben.encode({ method: 'putData', args: { v: v, mutableSalt: false } }), dump)
/*
request(
  ben.encode({ method: 'makeImmutableTarget', args: { v: v } }),
  (target) => { request(ben.encode({ method: 'getData', args: { target: target, mutableSalt: false } }), dump) }
)

// request(ben.encode({ method: 'putData', args: { v: v, mutableSalt: 'salt' } }), dump)
*/
const salt = 'salt'
/*
request(
  ben.encode({ method: 'makeMutableTarget', args: { k: null, mutableSalt: salt } }), // k == null: use local publick key
  (target) => { request(ben.encode({ method: 'getData', args: { target: target, mutableSalt: salt } }), dump) }
)
*/
/*
request(
  ben.encode({ method: 'makeMutableTarget', args: { k: null, mutableSalt: salt } }),
  (target) => { request(ben.encode({ method: 'putData', args: { v: v, mutableSalt: salt, resetTarget: target } }), dump) }
)
*/
function request (post, done) {
  http.request(
    {
      hostname: 'localhost',
      port: 6881,
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': post.length
      }
    },
    (res) => {
      let data = Buffer.alloc(0)
      res.on('data', (chunk) => { data = Buffer.concat([data, chunk]) })
      res.on('end', () => { try { data = ben.decode(data) } catch (err) { data = null }; done(data) })
    }
  ).end(post)
}
