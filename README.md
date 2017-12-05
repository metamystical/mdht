## mdht.js -- Mainline DHT

Dynamic Hash Table customized for the mainline DHT used by bittorrent to locate torrent peers without using a tracker
and including BEP44 data storage. IPv4 only.

### Terminology:

term | description
-----|------------
location (loc) | 6-byte buffer, network location (4-byte IPv4 address + 2-byte port)
peer | 6-byte buffer, location of a mainlne bittorrent client (TCP) that includes a DHT node, not always having the same port as its node
id | 20-byte buffer, a DHT node id or a torrent infohash
node | 26-byte buffer (20-byte id + 6-byte location), identfies and locates a DHT node (UDP)
contact | object version of a node { id: 20-byte buffer, loc: 6-byte location bufer }

### Usage (API):
```
const dhtInit = require('mdht')
const dht = dhtInit(options, update) // options is an object, update is a callback function
```
#### options:

option | description
-------|------------
options.port | UDP server port (integer, default 6881)
options.id | my node id (20-byte buffer, default random)
options.seed | seed for generating ed25519 key pair for signing mutable data (32-byte buffer, default random)
options.bootLocs | locations to contact at startup (buffer of concatenated 6-byte network locations, default empty)

#### dhtInit returns an object with the following methods:
```
dht.announcePeer(ih, (numVisited, numAnnounced) => {}, onV)
dht.getPeers(ih, (numVisited, peers) => {}, onV)
dht.putData(v, mutableSalt, resetTarget, (numVisited, numStored) => {}, onV) // returns 'ret' object
dht.getData(target, mutableSalt, (numVisited, { v: (object), seq: (int), numFound: (int) } or null if not found) => {}, onV)
dht.makeMutableTarget(k, mutableSalt)
dht.makeImmutableTarget(v)
```
##### where:

argument | description
---------|------------
ih | infohash of a torrent (20-byte buffer)
target | id of data stored in the DHT (20-byte buffer)
resetTarget | if not null, used to reset the timeout of previously stored mutable data (v ignored in this case), may be obtained from third party
mutableSalt | false or '' if immutable BEP44 data or true if mutable but no salt, or salt (non-empty string or buffer <= 64-bytes) which implies mutable
v | value stored in the DHT by putData and returned by getData (object, buffer, string or number)
seq | sequence number (int) of mutable data
k | public key use to verify mutable data (32-byte buffer)
ret | object with .target and applicable outgoing arguments .v, .salt, .seq, .k, .sig (ed25519 signature, 64-byte buffer), all as actually used
onV | if not null or undefined, called whenever a value is received (a peer or BEP44 data) with arguments (target/ih, response object)

#### update is a function which signals the calling program and is called with two arguments (key, value)

key | signal | value
----|--------|------
'udp' | initialization failed | local port (int) that failed to open; calling program should restart with a different port
'id' | initialized | id (buffer) actually used to create routing table
'publicKey' | initialized | public key (buffer) actually used for ed25519 signatures
'listening' | local udp socket is listening | { address: (string), port: (int), etc }
'ready' | bootstrap is complete | number of nodes visited during bootstrap
'incoming' | incoming query object | { q: query type (string), rinfo: remote node socket { address: (string), port: (int), etc } }
'error' | incoming error object | { e: [error code (int), error message (string)], rinfo: remote node socket { address: (string), port: (int), etc } }
'locs' | periodic report | buffer packed with node locations from the routing table; may used for disk storage
'closest' | periodic report | array of node id's from the routing table, the closest nodes to the table id
'peers' | periodic report | { numPeers: number of stored peers, infohashes: number of stored infohashes }
'data' | periodic report | number of BEP44 stored data items
'spam' | detected spammer node, temporarily blocked| 'address:port'
'dropContact' | contact dropped from routing table | { address: (string), port: (int) }
'dropPeer' | peer dropped from storage | { address: (string), port: (int) }
'dropData' | data dropped from BEP44 storage | target (buffer)


### test.js example program
This program provides a command line interface for mdht.js as well as an interface with disk storage.
The id, seed and boot locations are saved in separate files between sessions.
Without these files, the DHT will use random values for id and seed, but would require a boot location as a command line argument.
Usage: `require('mdht/test.js')` alone in a file named, for example, `test.js`.

### shim.js interface with Webtorrent
This program is a shim between mdht.js and [webtorrent](https://github.com/webtorrent/webtorrent)
as a replacement for [bittorrent-dht](https://github.com/webtorrent/bittorrent-dht), which is problematic.
[webtorrent/index.js](https://github.com/webtorrent/webtorrent/blob/master/index.js) needs to be modified locally
in `node_modules/webtorrent` so that it requires `mdht/shim` rather than `bittorrent-dht/client`. Then, invoke webtorrent like so:
```
const WebTorrent = require('webtorrent')
// must modify webtorrent to require mdht/shim instead of bittorrent-dht/client

const client = new WebTorrent({ torrentPort: port, dhtPort: port, dht: { nodeId: id, bootstrap: bootLocs, seed: seed } })
// `port` is a port number and `id`, `bootLocs` and `seed` are buffers destined for mdht.js (see dhtInit options above).
```

Then use (see [torr.js](https://github.com/metamystical/torr) for an example):
```
client.dht.once('ready', function () { )) // bootstrap complete, ready for new torrents

client.dht.on('nodes', function (nodes) { })
// periodic report of DHT routing table node locations for saving (see locs above)

client.dht.nodeId // actual nodeId used
const ret = client.dht.put(v, mutableSalt, resetTarget, function (numVisited, numStored) { })

client.dht.get(target, mutableSalt, function (numVisited, { v: (object), seq: (int), numFound: (int) }) { } )
// target is returned by put (see putData above) or computed 
// (see makeImmutableTarget and makeMutableTarget above) or obtained from a third party
```
