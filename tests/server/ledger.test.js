const { addLedgerPoints, computeSettlement, withUsernames } = require('../../src/server/ledger');

describe('addLedgerPoints', () => {
  test('accumulates points owed from one player to another', () => {
    const room = { ledger: {} };
    addLedgerPoints(room, 'alice', 'bob', 1);
    addLedgerPoints(room, 'alice', 'bob', 2);
    expect(room.ledger.alice.bob).toBe(3);
  });

  test('ignores a zero-point or self-to-self entry', () => {
    const room = { ledger: {} };
    addLedgerPoints(room, 'alice', 'alice', 5);
    addLedgerPoints(room, 'alice', 'bob', 0);
    expect(room.ledger).toEqual({});
  });
});

describe('computeSettlement', () => {
  test('nets mutual debts down to a single directed amount, converted to baht', () => {
    const room = { ledger: {} };
    addLedgerPoints(room, 'alice', 'bob', 5);
    addLedgerPoints(room, 'bob', 'alice', 2);
    const settlements = computeSettlement(room, 5);
    expect(settlements).toEqual([{ from: 'alice', to: 'bob', points: 3, baht: 15 }]);
  });

  test('omits pairs that net to zero', () => {
    const room = { ledger: {} };
    addLedgerPoints(room, 'alice', 'bob', 3);
    addLedgerPoints(room, 'bob', 'alice', 3);
    expect(computeSettlement(room, 5)).toEqual([]);
  });

  test('handles more than two players independently', () => {
    const room = { ledger: {} };
    addLedgerPoints(room, 'alice', 'bob', 2);
    addLedgerPoints(room, 'carol', 'bob', 1);
    const settlements = computeSettlement(room, 5);
    expect(settlements).toEqual(expect.arrayContaining([
      { from: 'alice', to: 'bob', points: 2, baht: 10 },
      { from: 'carol', to: 'bob', points: 1, baht: 5 },
    ]));
    expect(settlements).toHaveLength(2);
  });

  test('an empty ledger settles to nothing', () => {
    expect(computeSettlement({ ledger: {} }, 5)).toEqual([]);
  });
});

describe('withUsernames', () => {
  test('annotates each settlement with display usernames, defaulting to userId', () => {
    const room = { players: [{ userId: 'alice', username: 'Alice A.' }, { userId: 'bob' }] };
    const settlements = [{ from: 'alice', to: 'bob', points: 1, baht: 5 }];
    expect(withUsernames(room, settlements)).toEqual([
      { from: 'alice', to: 'bob', points: 1, baht: 5, fromUsername: 'Alice A.', toUsername: 'bob' },
    ]);
  });
});
