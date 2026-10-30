import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';

// Local development reads .env; production gets its env from the host.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config();
} catch { /* ignore */ }

// Boot Next.js and start HTTP listener.
async function main() {
  const dev = process.env.NODE_ENV !== 'production';
  const hostname = process.env.HOST || '0.0.0.0';
  const port = parseInt(process.env.PORT || '5000', 10);

  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  await app.prepare();
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });
  server.once('error', err => {
    console.error(err);
    process.exit(1);
  });
  server.listen(port, hostname, () => {
    console.log(`> Server listening at http://${hostname}:${port} as ${dev ? 'development' : 'production'}`);
  });
}

main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
