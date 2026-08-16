function waitForEvent(socket, event) {
  return new Promise(resolve => socket.once(event, resolve));
}

function collectEvents(socket, event) {
  const events = [];
  socket.on(event, payload => events.push(payload));
  return events;
}

function waitUntil(conditionFn, { timeout = 2000, interval = 20 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = async () => {
      if (await conditionFn()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('waitUntil timed out'));
      setTimeout(check, interval);
    };
    check();
  });
}

module.exports = { waitForEvent, collectEvents, waitUntil };
