import { TikTokClient } from './client.js';
import { TikTokRepository } from './repository.js';
import { TikTokService } from './service.js';
import { TikTokController } from './controller/controller.js';

export function createTikTokDomain() {
  const repository = new TikTokRepository();
  const client = new TikTokClient('');
  const service = new TikTokService(client, repository);
  const controller = new TikTokController(service);

  return { controller, service, repository, client };
}
