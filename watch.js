const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8890;
const waitingClients = new Set();
let debounceTimer = null;

const ignoredFiles = new Set(['watch.js', 'package.json', 'package-lock.json', '.DS_Store']);

function notifyReload(filename) {
  console.log(`\x1b[36m[Lumina Dev]\x1b[0m 📝 \x1b[33m${filename}\x1b[0m modified → \x1b[32mReloading extension in Chrome...\x1b[0m`);
  
  for (const res of waitingClients) {
    try {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ reload: true }));
    } catch (e) {
      // client disconnected
    }
  }
  waitingClients.clear();
}

// Watch project directory recursively for changes
fs.watch(__dirname, { recursive: true }, (eventType, filename) => {
  if (!filename) return;
  if (filename.startsWith('.') || filename.includes('node_modules') || ignoredFiles.has(filename)) return;

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    notifyReload(filename);
  }, 150);
});

const server = http.createServer((req, res) => {
  if (req.url === '/poll') {
    // Keep connection open until a file changes or timeout
    waitingClients.add(res);

    const timeout = setTimeout(() => {
      if (waitingClients.has(res)) {
        waitingClients.delete(res);
        try {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify({ reload: false }));
        } catch (e) {}
      }
    }, 25000);

    req.on('close', () => {
      clearTimeout(timeout);
      waitingClients.delete(res);
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`\x1b[32m✔ Lumina Auto-Reloader is active!\x1b[0m`);
  console.log(`\x1b[90mWatching:\x1b[0m ${__dirname}`);
  console.log(`\x1b[90mEvery time you save any file (Cmd+S / Ctrl+S), the extension auto-reloads.\x1b[0m\n`);
});
