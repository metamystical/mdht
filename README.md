## mdht.js -- Mainline DHT

Dynamic Hash Table customized for the mainline DHT used by bittorrent to locate torrent peers without using a tracker.
Includes BEP44 data storage. IPv4 only. References: [BEP5](http://www.bittorrent.org/beps/bep_0005.html), [BEP44](http://www.bittorrent.org/beps/bep_0044.html)

### Terminology:

Term | Description
-----|------------
*location* | network *location* (6-byte buffer: 4-byte IPv4 address + 2-byte port); example: Buffer.from('ff0000011ae1', 'hex') is '127.0.0.1:6881'
*id* | DHT node *id*, infohash of a torrent, or target of BEP44 data (20-byte buffer)
node | a member of the Mainline DHT network which uses UDP
peer | a bittorrent client associated with a DHT node which uses TCP, usually on the same port

### Usage (API):
```
const dhtInit = require('mdht')
const dht = dhtInit(options, update) // options is an object, update is a callback function
```
#### dhtInit options:

Option | Description
-------|------------
options.port | local UDP server port (int, default 6881)
options.id | local node *id* (default random)
options.seed | seed for generating ed25519 key pair for signing mutable data (32-byte buffer, default random)
options.bootLocs | remote node *locations* to contact at startup (buffer of concatenated *locations*, default empty)

#### dhtInit returns an object with the following methods:
```
dht.announcePeer(ih, (numVisited, numAnnounced) => {}, onV) // assumes local peer uses options.port
dht.getPeers(ih, (numVisited, values) => {}, onV)
dht.putData(v, mutableSalt, resetTarget, (numVisited, numStored) => {}, onV) // returns 'ret' object
dht.getData(target, mutableSalt, (numVisited, { v: ..., seq: ..., numFound: ... } or null if not found) => {}, onV)
dht.makeMutableTarget(k, mutableSalt)
dht.makeImmutableTarget(v)
```
##### where:

Argument | Description
---------|------------
ih | infohash, *id* of a torrent
values | array of peer *locations* which have the torrent with infohash ih
target | *id* of BEP44 data
v | BEP44 data stored in or retrieved from the DHT (object, buffer, string or number)
mutableSalt | if immutable BEP44 data then *false* or *''*; if mutable data then *true* if no salt, or *salt* (non-empty string or buffer -- string will be converted to buffer, buffer will be truncated to 64 bytes)
resetTarget | if not null, a target used to reset the timeout of previously stored mutable data (v is ignored in this case)
ret | object returned by putData with actually used outgoing .target and .v and (for mutable data) .salt, .seq, .k and .sig
seq | sequence number (int) of mutable data
sig | ed25519 signature of salt, v and seq (64-byte buffer)
k | public key used to make a mutable target and to sign and verify mutable data (32-byte buffer)
onV | if not null or undefined, called whenever peer locations or BEP44 data are received from a remote node, with a single argument: an object with .target and .values for getPeers and announce Peers, or .ih and .v for getData and putData

Note that getData can be used with values of target and mutableSalt provided by whomever stored the data. If target is unknown, it can be computed with makeMutableTarget (if k and mutableSalt are known) or makeImmutableTarget (if v is known).

#### update is a function which signals the calling program and is called with two arguments (key, value)

Key | Signal | Value
----|--------|------
'udpFail' | initialization failed | local port (int) that failed to open; calling program should restart using a different port
'id' | initialized | *id* actually used to create routing table
'publicKey' | initialized | public key (k) actually used for ed25519 signatures
'listening' | local udp socket is listening | { address: (string), port: (int), etc }
'ready' | bootstrap is complete | number of nodes visited during bootstrap
'incoming' | incoming query object | { q: query type (string), rinfo: remote node socket { address: (string), port: (int), etc } }
'error' | incoming error object | { e: [error code (int), error message (string)], rinfo: remote node socket { address: (string), port: (int), etc } }
'locs' | periodic report | buffer packed with node *locations* from the routing table; may used for disk storage
'closest' | periodic report | array of node *ids* from the routing table, the closest nodes to the table *id*
'peers' | periodic report | { numPeers: number of stored peer locations, infohashes: number of stored infohashes }
'data' | periodic report | number of BEP44 stored data items
'spam' | detected spammer node, temporarily blocked| 'address:port'
'dropNode' | node dropped from routing table | 'address:port'
'dropPeer' | peer location dropped from storage | 'address:port'
'dropData' | data dropped from BEP44 storage | 'target' (hex string)

### test.js example program This program provides a command line interface for mdht.js as well as
an interface with disk storage. The *id*, seed and boot *locations* are saved in separate files
between sessions. Without these files, the DHT will use random values for *id* and seed, but would
require a boot *location* as a command line argument. Usage: `require('mdht/test.js')` alone in a
file named, for example, `test.js`.

### shim.js interface with Webtorrent
This program is a shim between mdht.js and [webtorrent](https://github.com/webtorrent/webtorrent)
as a replacement for [bittorrent-dht](https://github.com/webtorrent/bittorrent-dht), which is problematic.
[webtorrent/index.js](https://github.com/webtorrent/webtorrent/blob/master/index.js) needs to be modified locally
in `node_modules/webtorrent` so that it requires `mdht/shim` rather than `bittorrent-dht/client`. Then, invoke webtorrent like so:
```
const WebTorrent = require('webtorrent')
// must modify webtorrent to require mdht/shim instead of bittorrent-dht/client

const client = new WebTorrent({ torrentPort: port, dhtPort: port, dht: { nodeId: *id*, bootstrap: bootLocs, seed: seed } })
// `port` is a port number and `*id*`, `bootLocs` and `seed` are buffers destined for mdht.js (see dhtInit options above).
```

Then use (see [torr.js](https://github.com/metamystical/torr) for an example):
```
client.dht.once('ready', function () { )) // bootstrap complete, ready for new torrents
client.dht.on('nodes', function (nodes) { }) // periodic report of DHT routing table node *locations* for saving
client.dht.nodeId // actual nodeId used
const ret = client.dht.put(v, mutableSalt, resetTarget, function (numVisited, numStored) { })
client.dht.get(target, mutableSalt, function (numVisited, { v: (object), seq: (int), numFound: (int) }) { } )
```
