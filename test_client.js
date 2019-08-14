const client = require('./client')

const argv = process.argv
if (argv.length === 3 && argv[2] > 1023 && argv[2] < 65536) client.init(argv[2])

const dump = (data) => { console.log(data) }

const ih = Buffer.from('3663c233ac0e1d329f538bab02128ba2c396467a', 'hex')
// client.announcePeer(ih , dump)
// client.getPeers(ih, dump)

const v = {m: 'JEB', f: 'MLK'}
// client.putData(v, false, null, dump)

// client.makeImmutableTarget(v, (target) => { client.getData(target, false, dump) })

// const salt = 'abc'
// client.putData(v, salt, null, dump)
// client.makeMutableTarget(null, salt, (target) => { client.getData(target, salt, dump) }) // k == null: use local public key
// client.makeMutableTarget(null, salt, (target) => { client.putData(v, salt, target, dump) }) // resetTarget

// const salt = true // mutable but no salt
// client.putData(v, salt, null, dump)
// client.makeMutableTarget(null, salt, (target) => { client.getData(target, salt, dump) }) // k == null: use local public key
