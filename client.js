const http = require('http')
const encode = require('./encode')
const decode = require('./decode')

const dump = (data) => { console.log(data) }

const ih = Buffer.from('3663c233ac0e1d329f538bab02128ba2c396467a', 'hex')
// request(encode({ method: 'announcePeer', args: { ih: ih } }), dump)
// request(encode({ method: 'getPeers', args: { ih: ih } }), dump)

const v = {m: 'JEB', f: 'MLK'}
// request(encode({ method: 'putData', args: { v: v, mutableSalt: false } }), dump)
/*
request(
  encode({ method: 'makeImmutableTarget', args: { v: v } }),
  (target) => { request(encode({ method: 'getData', args: { target: target, mutableSalt: false } }), dump) }
)
*/
const salt = ''
// request(encode({ method: 'putData', args: { v: v, mutableSalt: salt } }), dump)
/*
request(
  encode({ method: 'makeMutableTarget', args: { k: null, mutableSalt: salt } }), // k == null: use local publick key
  (target) => { request(encode({ method: 'getData', args: { target: target, mutableSalt: salt } }), dump) }
)
*/
/*
request(
  encode({ method: 'makeMutableTarget', args: { k: null, mutableSalt: salt } }),
  (target) => { request(encode({ method: 'putData', args: { v: v, mutableSalt: salt, resetTarget: target } }), dump) }
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
      res.on('end', () => { done(decode(data)) })
    }
  ).end(post)
}
