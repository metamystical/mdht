module.exports = DHT

const EventEmitter = require('events').EventEmitter
require('inherits')(DHT, EventEmitter)
const dhtInit = require('./mdht')

let dht, instanceDHT, udpAddress
let options = {}

const buff2ToInt = (buff) => { return (buff[0] << 8) + buff[1] }
const unmakeLoc = (loc) => { // convert 6-byte buffer to IPv4 address/port
  let str = ''
  for (let i = 0; i < 4; i++) str += loc[i] + (i < 3 ? '.' : '')
  return { host: str, port: buff2ToInt(loc.slice(4)) }
}
const update = (key, val) => {
  switch (key) {
    case 'id': instanceDHT.nodeId = val; break
    case 'listening': udpAddress = val; instanceDHT.listening = true; instanceDHT.emit('listening'); break
    case 'ready': instanceDHT.emit('ready'); break
    case 'locs': instanceDHT.emit('nodes', val); break
    case 'udp': console.log('fatal error opening port => ' + val); process.exit(0)
  }
}
const onPeers = (infohash, res) => {
  res && res.values && res.values.forEach((peer) => { instanceDHT.emit('peer', unmakeLoc(peer), infohash.toString('hex')) })
}

function DHT (opts) {
  opts || (opts = {})
  opts.nodeId && (options.id = opts.nodeId)
  opts.bootstrap && (options.bootLocs = opts.bootstrap)
  opts.seed && (options.seed = opts.seed)

  EventEmitter.call(this)
  this.nodeId = null
  this.listening = false
  instanceDHT = this
}
DHT.prototype.listen = (port) => { options.port = port; dht = dhtInit(options, update) }
DHT.prototype.address = () => { return udpAddress }
DHT.prototype.announce = (infoHash, port, done) => { dht.announcePeer(Buffer.from(infoHash, 'hex'), done, onPeers) }
DHT.prototype.destroy = (done) => { process.exit(0) }
DHT.prototype.addNode = (obj) => { }
DHT.prototype.put = dht.putData
DHT.prototype.get = dht.getData
