const { createRoomStore } = require('../../src/server/roomStore');

describe('createRoomStore', () => {
  test('stores and retrieves a room by id', () => {
    const store = createRoomStore();
    const room = { id: 'room1' };
    store.set('room1', room);
    expect(store.get('room1')).toBe(room);
  });

  test('get returns null for an unknown room', () => {
    const store = createRoomStore();
    expect(store.get('missing')).toBeNull();
  });

  test('has reflects presence, delete removes the room', () => {
    const store = createRoomStore();
    store.set('room1', { id: 'room1' });
    expect(store.has('room1')).toBe(true);
    store.delete('room1');
    expect(store.has('room1')).toBe(false);
    expect(store.get('room1')).toBeNull();
  });

  test('all lists every stored room', () => {
    const store = createRoomStore();
    store.set('room1', { id: 'room1' });
    store.set('room2', { id: 'room2' });
    expect(store.all().map(r => r.id).sort()).toEqual(['room1', 'room2']);
  });

  test('all is empty for a fresh store', () => {
    expect(createRoomStore().all()).toEqual([]);
  });

  test('two stores are independent', () => {
    const storeA = createRoomStore();
    const storeB = createRoomStore();
    storeA.set('room1', { id: 'room1' });
    expect(storeB.has('room1')).toBe(false);
  });
});
