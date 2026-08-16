require('dotenv').config();

const { createSocketServer } = require('./socketServer');

const PORT = process.env.PORT || 3001;
const { httpServer } = createSocketServer();
httpServer.listen(PORT, () => {
  console.log(`Kaeng game server listening on port ${PORT}`);
});
