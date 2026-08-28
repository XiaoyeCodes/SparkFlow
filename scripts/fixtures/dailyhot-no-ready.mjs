// Lifecycle-test child: intentionally never sends the ready handshake.
const timer = setInterval(() => {}, 1000);
process.on('disconnect', () => { clearInterval(timer); process.exit(0); });
process.on('message', (message) => { if (message?.type === 'shutdown') process.exit(0); });
