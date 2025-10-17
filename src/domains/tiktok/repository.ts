import { eq } from 'drizzle-orm';
import type { ITikTokRepository, TikTokUserInfo, TikTokVideo } from './interfaces/interfaces.js';
import { db } from '../../db/index.js';
import { users, videos } from '../../db/schema.js';
import { decrypt } from '../../lib/encryption.js';

export class TikTokRepository implements ITikTokRepository {
  async getUserTokens(userId: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date | null }> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user?.accessTokenEncrypted) {
      throw new Error('User not authenticated - no stored tokens');
    }

    const now = new Date();
    const expiresAt = user.tokenExpiresAt;

    if (expiresAt && expiresAt < new Date(now.getTime() + 5 * 60 * 1000)) {
      throw new Error('Token expired - refresh token flow not yet implemented');
    }

    return {
      accessToken: decrypt(user.accessTokenEncrypted),
      refreshToken: decrypt(user.refreshTokenEncrypted!),
      expiresAt,
    };
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
