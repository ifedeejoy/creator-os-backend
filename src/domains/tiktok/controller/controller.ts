import type { ITikTokService } from '../interfaces/interfaces';

export class TikTokController {
  constructor(private service: ITikTokService) { }

  async handleSync(userId: string): Promise<{ success: boolean; data: any }> {
    try {
      const result = await this.service.syncUserData(userId);
      return {
        success: true,
        data: result,
      };
    } catch (err: any) {
      throw new Error(`Sync failed: ${err.message}`);
    }
  }
}
