import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TikTokController } from '../controller/controller';

export function createTikTokRoutes(controller: TikTokController) {
  return {
    async handleSyncRequest(req: IncomingMessage, res: ServerResponse) {
      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });

      req.on('end', async () => {
        try {
          const payload = JSON.parse(body);
          const { userId } = payload;

          if (!userId) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'userId is required' }));
            return;
          }

          const result = await controller.handleSync(userId);

          if (!result.success) {
            res.writeHead(400);
            res.end(JSON.stringify(result));
            return;
          }

          res.writeHead(200);
          res.end(JSON.stringify(result));
        } catch (err: any) {
          console.error('Sync request error:', err);
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'Internal server error', message: err.message }));
        }
      });
    },
  };
}
