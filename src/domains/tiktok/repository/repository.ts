import { eq } from 'drizzle-orm';
import type { ITikTokRepository, TikTokUserInfo, TikTokVideo } from '../interfaces/interfaces.js';
import { SyncError, SyncErrorCode } from '../interfaces/interfaces.js';
import { db } from '../../../db/index.js';
import { users, videos } from '../../../db/schema.js';
import { decrypt, encrypt } from '../../../lib/encryption.js';
import axios from 'axios';

export class TikTokRepository implements ITikTokRepository {
  async getUserTokens(userId: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date | null }> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      throw new SyncError(SyncErrorCode.USER_NOT_AUTHENTICATED, `User not found: ${userId}`);
    }

    if (!user?.accessTokenEncrypted) {
      throw new SyncError(SyncErrorCode.USER_NOT_AUTHENTICATED, 'User not authenticated - no stored tokens');
    }

    const now = new Date();
    const expiresAt = user.tokenExpiresAt;

    console.log(`📋 Token info:
   Expires at: ${expiresAt?.toISOString() || 'N/A'}
   Now: ${now.toISOString()}
   Expires in: ${expiresAt ? Math.round((expiresAt.getTime() - now.getTime()) / 1000) : 'N/A'} seconds`);

    if (expiresAt && expiresAt < new Date(now.getTime() + 5 * 60 * 1000)) {
      if (!user.refreshTokenEncrypted) {
        throw new SyncError(
          SyncErrorCode.TOKEN_EXPIRED,
          'TikTok token has expired. Please re-authenticate.',
          { expiresAt }
        );
      }

      try {
        console.log('🔄 Attempting to refresh token...');
        const refreshToken = decrypt(user.refreshTokenEncrypted);
        const newTokens = await this.refreshAccessToken(refreshToken);

        await db
          .update(users)
          .set({
            accessTokenEncrypted: encrypt(newTokens.access_token),
            refreshTokenEncrypted: encrypt(newTokens.refresh_token),
            tokenExpiresAt: new Date(Date.now() + newTokens.expires_in * 1000),
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));

        console.log('✅ Token refreshed successfully');
        return {
          accessToken: newTokens.access_token,
          refreshToken: newTokens.refresh_token,
          expiresAt: new Date(Date.now() + newTokens.expires_in * 1000),
        };
      } catch (err) {
        console.error('❌ Token refresh failed:', err);
        throw new SyncError(
          SyncErrorCode.TOKEN_EXPIRED,
          'TikTok token has expired and refresh failed. Please re-authenticate.',
          { error: err instanceof Error ? err.message : 'Unknown error' }
        );
      }
    }

    try {
      const accessToken = decrypt(user.accessTokenEncrypted);
      console.log(`✅ Token decrypted successfully (length: ${accessToken.length})`);
      return {
        accessToken,
        refreshToken: decrypt(user.refreshTokenEncrypted!),
        expiresAt,
      };
    } catch (err) {
      console.error('❌ Token decryption failed:', err);
      throw new SyncError(
        SyncErrorCode.TOKEN_INVALID,
        'Failed to decrypt stored token. Encryption key may not match.',
        { error: err instanceof Error ? err.message : 'Unknown error' }
      );
    }
  }

  private async refreshAccessToken(refreshToken: string) {
    try {
      const response = await axios.post(
        'https://open.tiktokapis.com/v2/oauth/token/',
        new URLSearchParams({
          client_key: process.env.TIKTOK_CLIENT_KEY!,
          client_secret: process.env.TIKTOK_CLIENT_SECRET!,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      return response.data;
    } catch (err: any) {
      const status = err?.response?.status;
      const tiktokError = err?.response?.data ?? err?.message;
      throw new Error(`Token refresh failed (${status}): ${JSON.stringify(tiktokError)}`);
    }
  }

  async updateUserProfile(userId: string, userInfo: TikTokUserInfo): Promise<void> {
    await db
      .update(users)
      .set({
        followerCount: userInfo.follower_count,
        followingCount: userInfo.following_count,
        totalLikes: userInfo.likes_count,
        avatarUrl: userInfo.avatar_url,
        bio: userInfo.bio_description,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  async upsertVideos(userId: string, videoList: TikTokVideo[]): Promise<number> {
    let upsertCount = 0;

    for (const video of videoList) {
      const totalInteractions = (video.like_count ?? 0) + (video.comment_count ?? 0) + (video.share_count ?? 0);
      const views = Math.max(0, video.view_count ?? 0);
      const engagementRate = views > 0 ? ((totalInteractions / views) * 100).toFixed(2) : '0.00';

      await db
        .insert(videos)
        .values({
          userId,
          tiktokVideoId: video.id,
          description: video.video_description || video.title,
          viewCount: video.view_count,
          likeCount: video.like_count,
          commentCount: video.comment_count,
          shareCount: video.share_count,
          engagementRate,
          videoCreatedAt: new Date(video.create_time * 1000),
        })
        .onConflictDoUpdate({
          target: videos.tiktokVideoId,
          set: {
            viewCount: video.view_count,
            likeCount: video.like_count,
            commentCount: video.comment_count,
            shareCount: video.share_count,
            engagementRate,
          },
        });

      upsertCount++;
    }

    return upsertCount;
  }
}
