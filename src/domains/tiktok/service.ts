import type { ITikTokService, ITikTokClient, ITikTokRepository, SyncResult } from './interfaces/interfaces.js';

export class TikTokService implements ITikTokService {
  constructor(private client: ITikTokClient, private repository: ITikTokRepository) { }

  async syncUserData(userId: string): Promise<SyncResult> {
    const { accessToken } = await this.repository.getUserTokens(userId);

    this.client = new (this.client.constructor as any)(accessToken);

    const userInfo = await this.client.getUserInfo();
    await this.repository.updateUserProfile(userId, userInfo);

    const userVideos = await this.client.getUserVideos(100);
    const videosCount = await this.repository.upsertVideos(userId, userVideos);

    return {
      userInfo,
      videosCount,
    };
  }
}
