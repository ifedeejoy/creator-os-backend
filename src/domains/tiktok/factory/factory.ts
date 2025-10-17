import { TikTokClient } from '../utils/client';
import { TikTokRepository } from '../repository/repository';
import { TikTokService } from '../services/service';
import { TikTokController } from '../controller/controller';

export function createTikTokDomain() {
  const repository = new TikTokRepository();
  const client = new TikTokClient('');
  const service = new TikTokService(client, repository);
  const controller = new TikTokController(service);

  return { controller, service, repository, client };
}
