const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp, normalizeCardData } = require('../app');

function createFakeRes() {
  const values = [];
  return {
    append(name, value) {
      values.push([name, value]);
    },
    get cookies() {
      return values
        .filter(([name]) => name === 'Set-Cookie')
        .map(([, value]) => value);
    },
  };
}

function createTestApp() {
  const dbPath = path.join(os.tmpdir(), `diy-pokemon-card-${Date.now()}-${Math.random()}.db`);
  const app = createApp({
    dbPath,
    env: {
      NODE_ENV: 'test',
    },
  });

  return {
    app,
    dbPath,
    cleanup() {
      app.locals.db.close();
      fs.rmSync(dbPath, { force: true });
      fs.rmSync(`${dbPath}-shm`, { force: true });
      fs.rmSync(`${dbPath}-wal`, { force: true });
    },
  };
}

test('guest session persists across requests and promo credit can be refunded', () => {
  const harness = createTestApp();
  const services = harness.app.locals.services;

  try {
    const firstReq = { headers: {}, get() { return ''; } };
    const firstRes = createFakeRes();
    const account = services.getOrCreateSessionAccount(firstReq, firstRes);

    assert.equal(account.totalCredits, 1);
    assert.equal(firstRes.cookies.length, 1);

    const sessionCookie = firstRes.cookies[0].split(';')[0];
    const secondReq = { headers: { cookie: sessionCookie }, get() { return ''; } };
    const secondRes = createFakeRes();
    const sameAccount = services.getOrCreateSessionAccount(secondReq, secondRes);

    assert.equal(sameAccount.id, account.id);
    assert.equal(secondRes.cookies.length, 0);

    const reservation = services.reserveCredit(account.id, 'design');
    assert.equal(reservation.ok, true);
    assert.equal(services.getAccountById(account.id).totalCredits, 0);

    const refunded = services.refundReservedCredit(reservation.requestId);
    assert.equal(refunded, true);
    assert.equal(services.getAccountById(account.id).totalCredits, 1);
  } finally {
    harness.cleanup();
  }
});

test('checkout finalization is idempotent and increases paid credits once', () => {
  const harness = createTestApp();
  const services = harness.app.locals.services;

  try {
    const req = { headers: {}, get() { return ''; } };
    const res = createFakeRes();
    const account = services.getOrCreateSessionAccount(req, res);

    const result1 = services.finalizeCheckoutSession({
      id: 'cs_test_123',
      metadata: {
        accountId: account.id,
        credits: '5',
        plan: 'pack5',
        email: 'trainer@example.com',
      },
      customer_details: {
        email: 'trainer@example.com',
      },
    });

    assert.equal(result1.alreadyProcessed, false);
    assert.equal(services.getAccountById(account.id).paidCredits, 5);
    assert.equal(services.getAccountById(account.id).totalCredits, 6);

    const result2 = services.finalizeCheckoutSession({
      id: 'cs_test_123',
      metadata: {
        accountId: account.id,
        credits: '5',
        plan: 'pack5',
        email: 'trainer@example.com',
      },
      customer_details: {
        email: 'trainer@example.com',
      },
    });

    assert.equal(result2.alreadyProcessed, true);
    assert.equal(services.getAccountById(account.id).paidCredits, 5);
    assert.equal(services.getAccountById(account.id).email, 'trainer@example.com');
  } finally {
    harness.cleanup();
  }
});

test('normalizeCardData clamps unsafe values', () => {
  const card = normalizeCardData({
    name: 'WayTooLongPokemonName',
    hp: 999,
    type: 'Unknown',
    attack1: {
      name: '123456789012345678901234567890',
      damage: -50,
      desc: '<script>alert(1)</script>',
    },
    attack2: {
      name: 'Mega Blast',
      damage: 999,
      desc: 'ok',
    },
    weakness: 'Water',
    resistance: 'Mystery',
    retreatCost: 99,
    flavor: 'x'.repeat(500),
  });

  assert.equal(card.name.length <= 12, true);
  assert.equal(card.hp, 90);
  assert.equal(card.type, 'Normal');
  assert.equal(card.attack1.damage, 0);
  assert.equal(card.attack2.damage, 90);
  assert.equal(card.resistance, 'Normal');
  assert.equal(card.retreatCost, 4);
  assert.equal(card.flavor.length <= 160, true);
});
