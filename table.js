// This module provides a routing table customized for use with the Mainline DHT. It is
// a variation of a binary sort tree, sorted according to closeness to the table id,
// using the exclusive-or operation to determine distance.
//
// The Table constructor creates a 'table' object containing a 'tree' for storing
// 'contact' objects of the form { id: 20-byte buffer, loc: 6-byte buffer }, where 'loc'
// is the contact's network location. The tree is actually an array, with each element
// being like a tree node. Each node is an array containing two 'contacts' arrays:
// element 0 and element 1. Initially the tree contains one node, the 'root' of the tree.
//
// A new contact is assigned to element 1 if its most significant bit (msb) matches the
// msb of the table id. (A matching bit implies closest ex-or distance.) Otherwise it is
// assigned to element 0. The two contacts arrays can each hold up to maxContacts contact
// objects.
//
// If element 1 is full and a new contact is assigned to it, a new node is added to the
// tree and all of the element 1 contacts plus the new contact are moved to the new node,
// split among the new node's two elements according to whether the next most significant
// bit matches. Thus, all nodes will have element 1 empty except the current last node in
// the tree, the only node able to split, named the 'tip node'.
//
// If element 0 is full and a new contact is assigned to it, the new contact is discarded.
// This algorithm gives preference to adding contacts with id's close to the table id,
// which is efficient for routing.
//
// The closestContacts method returns an array of the contacts stored in the tip node,
// sorted using the ex-or metric. These are the closest contacts to the table.id.
//
// The createTempTable method creates a temporary table with a new table id, using an
// existing table as a source of contacts. The new table is useful for obtaining the closest
// contacts to the new id, either immediately or after repopulating it with new contacts,
// It is allowed to include its own table.id as a contact since it is not meant to be used
// for routing. It does not update the timestamps of existing contacts when they are added
// so that the existing table can continue to be refreshed properly.
//
// The refreshTable method is meant to be called periodically to check the stalest
// contacts in a table by pinging them. Responding contacts should be re-added to the
// table to update the timestamp. Unresponsive contacts are removed by this method upon
// the next call.

module.exports = Table

const defaultMaxContacts = 8 // maximum length of contacts arrays

function Table (id, isTemp, maxContacts) { // can omit both isTemp and maxContacts, or maxContacts
  this.id = id
  this.isTemp = isTemp
  this.tree = [[[], []]]
  this.numContacts = 0
  this.maxContacts = maxContacts || defaultMaxContacts
}

Table.prototype.findContact = function (id) {
   // get bit b from an id (b == 0 is most significant bit)
  function getBit (id, b) { return (id[~~(b / 8)] & (1 << (7 - (b % 8)))) === 0 ? 0 : 1 }

  // get most-significant non-matching bit comparing the id to the table.id
  let x = 0
  for (const len = id.length * 8; x < len; x++) { if (getBit(id, x) !== getBit(this.id, x)) break }

  // determine coordinates within the table's tree to find or store the contact with the provided id

  const tip = this.tree.length - 1 // last node in the tree
  const inside = (x <= tip) // x is within the range of the tree array

  const y = inside ? x : tip // y is the tree array index for the id; it selects a node
  const z = inside ? 0 : 1 // z is the node array index; it selects a contacts array
  const contacts = this.tree[y][z]

   // i is the contacts array index; it selects the contact with the provided id if present
  let i = 0
  for (const len = contacts.length; i < len; i++) { if (contacts[i].id.equals(id)) break }
   // i = contacts.length if the contact is not in the array

  return { y: y, z: z, i: i } // return id coordinates
}

Table.prototype.addContact = function (contact) {
  if (!this.isTemp) {
    if (contact.id.equals(this.id)) return
    contact.time = Date.now()
  }
  const { y, z, i } = this.findContact(contact.id) // id coordinates
  const node = this.tree[y]
  const contacts = node[z]

  if (i < contacts.length) { // contact found in table tree; update it
    contacts[i] = contact
    return
  }
  if (contacts.length < this.maxContacts) { // contact not found in table tree, add it
    contacts.push(contact)
    ++this.numContacts
    return
  }

  if (z === 0) return // element 0 contacts full but cannot split; contact discarded

  // z === 1, split
  contacts.push(contact); ++this.numContacts // add new contact to element 1 contacts
  this.tree.push([[], []]) // add an empty node to the tree; it becomes the new tip node
  contacts.forEach((c) => { // copy references of all old element 1 contacts to the new tip node
    const { y, z } = this.findContact(c.id)
    this.tree[y][z].push(c)
  })
  // remove all contact references from old element 1 contacts
  // must use node[z], not 'contacts' to change original array
  node[z] = []
}

Table.prototype.allContacts = function () {
  let contacts = []
  this.tree.forEach((node) => { contacts = contacts.concat(node[0]) })
  contacts = contacts.concat(this.tree[this.tree.length - 1][1])
  return contacts
}

Table.prototype.closestContacts = function () {
  const id = this.id
  const tipNode = this.tree[this.tree.length - 1]
  return tipNode[0].concat(tipNode[1]).sort((a, b) => { // merge all tipNode contacts before sorting
    for (let i = 0; i < a.id.length; i++) {
      const aByte = a.id[i] ^ id[i]; const bByte = b.id[i] ^ id[i]
      if (aByte === bByte) continue
      return aByte - bByte
    }
    return 0
  })
}

Table.prototype.createTempTable = function (id) {
  const tempTable = new Table(id, true, this.maxContacts)
  this.allContacts().forEach((c) => { tempTable.addContact(c) })
  return tempTable
}

Table.prototype.refreshTable = function (ping, drop) {
  const ratio = 0.1 // ratio of contacts to ping each time refresh method is invoked

  this.allContacts()
  .filter((contact) => { // remove contacts unresponsive to previous ping
    if (contact.time !== 0) return true
    drop && drop(contact.loc)
    const { y, z, i } = this.findContact(contact.id)
    this.numContacts -= this.tree[y][z].splice(i, 1).length
    return false
  })
  .sort((a, b) => { return a.time - b.time }) // stalest have priority
  .filter((contact, index) => { return index <= ~~(this.numContacts * ratio) })
  .forEach((contact) => {
    contact.time = 0
    ping(contact.loc)
  })

  // consolidate tree if tip node is depleted
  if (
    this.allContacts().length > this.maxContacts &&
    this.closestContacts().length < this.maxContacts
  ) {
    this.tree = this.createTempTable(this.id).tree
  }
}
