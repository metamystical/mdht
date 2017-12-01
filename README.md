## mdht -- Mainline DHT

Dynamic Hash Table customized for the mainline DHT used by bittorrent to locate torrent peers without using a tracker. Currently uses only IPv4.

### Usage:
```
const dhtInit = require('mdht')
const dht = dhtInit(options, update) // options is an object, update is a callback function
```
```
options:
  options.port -- UDP server port (integer, default 6881)
  options.id -- my node id (20-byte buffer, default random)
  options.seed -- seed for generating ed25519 key pair for signing mutable data (32-byte buffer, default random)
  options.bootLocs -- locations to contact at startup (buffer of concatenated 6-byte network locations, default empty)
```
```
dhtInit returns an object with the following methods:
  dht.announcePeer(ih, (numVisited, numAnnounced) => {})
  dht.getPeers(ih, (peers, numVisited) => {})
  dht.putData(v, salt, mutable, reset, (numVisited, numStored) => {}) // returns a
  dht.getData(target, salt, (v, seq, numVisited, numFound) => {})
  dht.makeSalt(string | buffer) // returns a valid salt buffer <= 64 bytes, given a string or buffer
  dht.makeMutableTarget(k, salt) // returns a mutable target
  dht.makeImmutableTarget(v) // returns an Immutable target
  
  where:
   ih -- infohash of a torrent (20-byte buffer)
   target -- id of data stored in the DHT (20-byte buffer)
   v -- value stored in the DHT by putData and returned by getData (object, buffer, string or number)
   k -- public key (32-byte buffer)
   salt -- if not null, used to vary the target of mutable data for a given public key (<= 64-byte buffer)
   mutable -- true if mutable data, false if immutable (boolean)
   a -- outgoing object with .v and .target, and if mutable: .salt (if used), .seq (sequence number), .k, .sig (ed25519 signature, 64-byte buffer)
   reset -- if not null, a target (possibly obtained from elsewhere along with salt) to reset the timeout of previously stored mutable data
```
```
update is a function to signal the calling program, called with two arguments key (string): value (type depends on key)
  'id': same as options.id
  'publicKey': same as k
  'listening': udp socket address object, including .port (int)
  'ready': number of nodes visited during bootstrap, signals bootstrap complete
  'locs': buffer packed with node addresses from the routing table, each a 6-byte network location
  'closest': array of node id buffers from the routing table, the closest nodes to the table id
  'incoming': incoming query object, .q = query type (string), .rinfo = remote node object including .address and .port
  'peers': object containing stored peer statistics, .numPeers = number of peers, .infohashes = number of infohashes
  'data': number of stored BEP44 data items
  'spam': detected spammer node, in 'address:port' form
  'dropContact': node dropped from routing table, in { address: ..., port: ... } form
  'dropPeer': peer dropped from storage, in { address: ..., port: ... } form
  'dropData': data dropped from storage, in { address: ..., port: ... } form
  'error': incoming object with .rinfo (see 'incoming') and .e, an array [ error code (int), error message (string)]
  'udp': port number that failed to open, fatal error
```

### Example program test.js
This program provides a command line interface for mdht.js as well as an interface with disk storage. The id, seed and boot locations are saved in separate files between sessions. Without these files, the DHT will use random values for nodeId and seed, but would require a boot location as a command line argument. Usage: `require('mdht/test.js')` alone in a file named, for example, `test.js`. 

### shim.js interface with Webtorrent
This program is a shim between mdht.js and [webtorrent](https://github.com/webtorrent/webtorrent) as a replacement for [bittorrent-dht](https://github.com/webtorrent/bittorrent-dht), which is problematic. [webtorrent/index.js](https://github.com/webtorrent/webtorrent/blob/master/index.js) needs to be modified locally in `node_modules/webtorrent` so that it requires `mdht/shim` rather than `bittorrent-dht/client`. Then, invoke webtorrent like so:
```
const WebTorrent = require('webtorrent')  // must modify webtorrent to require mdht/shim instead of bittorrent-dht/client
const client = new WebTorrent({ torrentPort: port, dhtPort: port, dht: { nodeId: id, bootstrap: nodes, seed: seed } })
  where `port` is a number and `id`, `nodes` and `seed` are buffers destined for mdht.js (see above).
```
Then use (see [torr.js](https://github.com/metamystical/torr) for an example):
```
client.dht.once('ready', function () { )) // bootstrap complete, ready for new torrents
client.dht.on('nodes', function (nodes) { }) // periodic report of DHT routing table node locations for saving (see locs above) 
client.dht.nodeId // actual nodeId used
const a = client.dht.put(v, salt, function (numVisited, numStored) { }) // see above for v, salt and a
client.dht.get(target, function (v, seq, numVisited, numFound) { } ) // see above for v, seq; target is returned by put
  or computed from v (immutable) or k, salt (mutable) (see makeImmutableTarget and makeMutableTarget above)
```

