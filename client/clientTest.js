#!/usr/bin/env node

// Syntax: clientTest.js [server-port]
//
//  server-port -- valid decimal port number (optional, default 6881)
//
// clientTest.js sends test requests to the DHT server and displays responses.
// This file can be used as a guide to writing customized clients.

const cl = require('./clientLib')

const defaultPort = 6881
let port = defaultPort

const argv = process.argv
if (argv.length === 3 && argv[2] > 1023 && argv[2] < 65536) port = argv[2]

cl.port = port 

console.log('DHT server tests')
const ih = cl.hexToBuff('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
const v = { m: 'JEB', f: 'MLK' }
const salt = 'salty'

// Uncomment tests you wish to run in the "tests" array below. Uncommented tests
// will run consecutively. Tests are arranged in groups meant to be bundled..
//
// The target returned by makeImmutableTarget or makeMutableTarget is used
// in the next test if "target" or "resetTarget" is initially set to 'empty'.
//
// makeImmutableTarget and makeMutableTarget are not really needed here
// because the target is returned by the previous putData test.

const tests = [
  { request: { method: 'announcePeer', args: { ih: ih, port: port, impliedPort: 1 } }, comment: '' },
  { request: { method: 'getPeers', args: { ih: ih } }, comment: '' },

//  { request: { method: 'putData', args: { v: v, mutableSalt: false, resetTarget: null } }, comment: 'immutable' },
//  { request: { method: 'makeImmutableTarget', args: { v: v } }, comment: '' },
//  { request: { method: 'getData', args: { target: 'empty', mutableSalt: false } }, comment: 'immutable' },

//  { request: { method: 'putData', args: { v: v, mutableSalt: true, resetTarget: null } }, comment: 'mutable, no salt' },
//  { request: { method: 'makeMutableTarget', args: { k: null, mutableSalt: true } }, comment: 'k = null: use local public key' },
//  { request: { method: 'getData', args: { target: 'empty', mutableSalt: true } }, comment: 'mutable, no salt' },

//  { request: { method: 'putData', args: { v: v, mutableSalt: salt, resetTarget: null } }, comment: 'mutable, salt' },
//  { request: { method: 'makeMutableTarget', args: { k: null, mutableSalt: salt } }, comment: 'k = null: use local public key' },
//  { request: { method: 'getData', args: { target: 'empty', mutableSalt: salt } }, comment: 'mutable' },
//  { request: { method: 'makeMutableTarget', args: { k: null, mutableSalt: salt } }, comment: 'k = null: use local public key' },
//  { request: { method: 'putData', args: { v: v, mutableSalt: salt, resetTarget: 'empty' } }, comment: 'mutable, salt, reset target' },
]

if (tests.length) tester(tests.shift())

function tester (test) {
  console.log('\nTesting:', test.request.method, test.comment)
  console.log('Sending:', test.request)
  cl.request(test.request, (data) => {
    if (!data) return
    if (data.peers) { data.peers.forEach((peer, inx, array) => { array[inx] = convertToIPPort(peer) }) }
    console.log('Response:', data)
    const nextObj = tests.shift()
    if (!nextObj) return
    const args = nextObj.request.args
    if (args.resetTarget === 'empty') args.resetTarget = cl.hexToBuff(data)
    if (args.target === 'empty') args.target = cl.hexToBuff(data)
    setImmediate(tester, nextObj)
  })
}

function convertToIPPort (loc) {
  loc = Buffer.from(loc, 'hex')
  let str = ''
  for (let i = 0; i < 4; i++) str += loc[i] + (i < 3 ? '.' : '')
  return { address: str, port: buff2ToInt(loc.slice(4)) }
}

function buff2ToInt (buff) { return (buff[0] << 8) + buff[1] }
