## mdht -- Mainline DHT implemented in node.js

Dynamic Hash Table customized for the Mainline DHT used by bittorrent to locate torrent peers without using a tracker.
Includes BEP44 data storage. IPv4 only. References: [BEP5](http://www.bittorrent.org/beps/bep_0005.html), [BEP44](http://www.bittorrent.org/beps/bep_0044.html)

### Quick start

```
$ npm i mdht
$ echo "require('mdht/server')" > server.js
$ node server.js
```
server.js will connect to the global mainline DHT via default UDP port 6881 (which should be forwarded),
by bootstraping from router.bittorrent.com:6881, and then will begin to respond to requests from
other nodes, using a random node id. Configuration information and incoming requests are
displayed on the console. The id, routing table and cryptographic seed are
saved to disk for future restarts.

server.js interfaces between mdht.js (which in turn interfaces with the DHT network), the user
(via the command line) and the disk (to preserve its state between sessions). It also accepts
commands from clients to issue outgoing requests to other DHT nodes via HTTP PUTs on the same port.

Navigating to http://localhost:6881 (default port) in a browser loads a web page from server.js via HTTP GET,
containing a simple UI for getting and putting BEP44 data and for announcing and getting peers.
Alternatively, client/clientLib.js is available to include in custom clients running in a browser
or running under Node.js. See client/clientTest.js for examples.

### Terminology

Term | Description
-----|------------
*location* | network *location* (6-byte buffer: 4-byte IPv4 address + 2-byte port); example: Buffer.from('ff0000011ae1', 'hex') represents 127.0.0.1:6881
*id* | DHT node *id*, infohash of a torrent, or target of BEP44 data (20-byte buffer)
node | a member of the Mainline DHT network which uses UDP
peer | a bittorrent client associated with a DHT node which uses TCP, usually on the same port

### Usage (API)
```
const dhtInit = require('mdht')
const dht = dhtInit(options, update) // options is an object, update is a callback function
```
#### dhtInit options

Option | Description
-------|------------
options.port | local UDP server port (int, default 6881)
options.id | local node *id* (default random)
options.seed | seed for generating ed25519 key pair for signing mutable data (32-byte buffer, default random)
options.bootLocs | remote node *locations* to contact at startup (buffer of concatenated *locations*, default empty)

#### dhtInit returns an object with the following methods:
```
dht.announcePeer(ih, impliedPort, ({ numVisited: ..., numStored: ... }) => {}, onV)
dht.getPeers(ih, ({ numVisited: ..., numFound: ..., peers: ... }) => {}, onV)
dht.putData(v, mutableSalt, resetTarget, ({ numVisited: ..., numStored: ..., target: ..., v: ..., salt: ..., seq: ..., k: ..., sig: ... }) => {}, onV)
dht.getData(target, mutableSalt, ({ numVisited: ..., numFound: ..., v: ..., seq: ... }) => {}, onV)
dht.makeMutableTarget(k, mutableSalt)
dht.makeImmutableTarget(v)
dht.stop()
```
##### where:

*announcePeer*, *getPeers*, *putData* and *getData* initiate outgoing DHT queries to remote nodes and return
information and/or results in their first callback function after all nodes have responded.

Their first callback function returns a single object with multiple properties pertinent to the method.
Object properties that do not apply or were not found are omitted. For example, there will be no
.peers or .v property if no peers or values are found; and .salt, .seq, .k and .sig are only returned for
mutable data.

Their second callback function, onV, if not null or undefined, is called immediately whenever peer
locations or BEP44 data are received from a remote node, with a single argument: an object with
.target and .values for *getPeers* and *announcePeer*, or .ih and .v for *getData* and *putData*,
plus .socket in both cases, which is just an object version of a node *location*
{ address: (string), port: (int) }.

*makeMutableTarget* and *makeImmutableTarget* are utilities for computing targets (node *ids*) for use
with *getData* or *putData*, which can be called with the arguments target or resetTarget, respectively,
along with mutableSalt, as provided by whomever stored the data. If the target is unknown, it can be
computed with *makeMutableTarget* (if k and mutableSalt are known) or *makeImmutableTarget*
(if v is known).

*stop* stops timers and closes the udp connection, thus stopping the DHT.

Argument | Description
---------|------------
ih | infohash, *id* of a torrent (buffer)
impliedPort | if 1, ignore local port and use externally visible port (undefined, 0 or 1)
target | *id* of BEP44 data (buffer)
v | BEP44 data to be stored in the DHT (object, buffer, string or number)
mutableSalt | if immutable BEP44 data then *false* or *''*; if mutable data then *true* if no salt, or *salt* (non-empty string or buffer -- string will be converted to buffer, buffer will be truncated to 64 bytes)
resetTarget | if not null, a target used to reset the timeout of previously stored mutable data (v is ignored in this case) (buffer)
k | public key used to make a mutable target (buffer); if null, local public key is used

Property | Description
---------|------------
values | array of peer *locations* which have the torrent with infohash ih
target | computed *id* of BEP44 data
v | for putData, BEP44 data actually stored (may be a retrieved value if resetTarget is used); for getData, retrieved BEP44 data
salt | salt actually used (<= 64-byte buffer)
seq | sequence number (int) of mutable data; outgoing/incoming for putData/getData
k | public key used to sign and verify mutable data (32-byte buffer)
sig | ed25519 signature of salt, v and seq (64-byte buffer)

#### update is a function which signals the calling program and is called with two arguments (key, value)

Key | Signal | Value
----|--------|------
'udpFail' | initialization failed | local port (int) that failed to open; calling program should restart using a different port
'id' | initialized | *id* actually used to create routing table
'publicKey' | initialized | public key (k) actually used for ed25519 signatures
'listening' | local udp socket is listening | local socket
'ready' | bootstrap is complete | number of remote nodes visited during bootstrap
'incoming' | incoming query object | { q: query type (string), socket: remote socket }
'error' | incoming error object | { e: [error code (int), error message (string)], socket: remote socket }
'nodes' | periodic report | buffer packed with node *locations* from the routing table; may used for disk storage
'closest' | periodic report | array of node *ids* from the routing table, the closest nodes to the table *id*
'peers' | periodic report | { numPeers: number of stored peer locations, numInfohashes: number of stored infohashes }
'data' | periodic report | number of BEP44 stored data items
'spam' | detected spammer node, temporarily blocked| 'address:port'
'dropNode' | node dropped from routing table | 'address:port'
'dropPeer' | peer location dropped from storage | 'address:port'
'dropData' | data dropped from BEP44 storage | 'target' (hex string)
