import type { ITikTokService } from '../interfaces/interfaces.js';
import { SyncError, SyncErrorCode } from '../interfaces/interfaces.js';

export class TikTokController {
  constructor(private service: ITikTokService) {}

  async handleSync(userId: string): Promise<{ success: boolean; data?: any; error?: string; errorCode?: string }> {
    try {
      const result = await this.service.syncUserData(userId);
      return {
        success: true,
        data: result,
      };
    } catch (err: any) {
      if (err instanceof SyncError) {
        return {
          success: false,
          error: err.message,
          errorCode: err.code,
        };
      }
      return {
        success: false,
        error: err?.message || 'Unknown error occurred',
        errorCode: SyncErrorCode.UNKNOWN,
      };
    }
  }
}
