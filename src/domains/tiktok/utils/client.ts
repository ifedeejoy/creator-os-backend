import axios from 'axios';
import type { ITikTokClient, TikTokUserInfo, TikTokVideo } from '../interfaces/interfaces.js';

const TIKTOK_API_BASE = 'https://open.tiktokapis.com/v2';

export class TikTokClient implements ITikTokClient {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
    console.log(`🔑 TikTokClient initialized with token (length: ${accessToken.length})`);
  }

  async getUserInfo(): Promise<TikTokUserInfo> {
    try {
      console.log('📤 Fetching user info from TikTok API...');
      const response = await axios.get(`${TIKTOK_API_BASE}/user/info/`, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
        params: {
          fields: 'open_id,union_id,avatar_url,display_name,bio_description,follower_count,following_count,likes_count,video_count',
        },
      });

      console.log('✅ User info fetched successfully');
      console.log('👤 User Info:', JSON.stringify(response.data.data.user, null, 2));
      return response.data.data.user;
    } catch (err: any) {
      const status = err?.response?.status;
      const tiktokError = err?.response?.data ?? err?.message;
      throw new Error(`TikTok user.info failed (${status ?? 'no-status'}): ${JSON.stringify(tiktokError)}`);
    }
  }

  async getUserVideos(totalDesired = 100): Promise<TikTokVideo[]> {
    const collected: TikTokVideo[] = [];
    let cursor: string | undefined = undefined;
    const fields = 'id,create_time,cover_image_url,share_url,video_description,duration,height,width,title,embed_html,embed_link,like_count,comment_count,share_count,view_count';

    try {
      while (collected.length < totalDesired) {
        const remaining = totalDesired - collected.length;
        const pageSize = Math.min(20, Math.max(1, remaining));

        const body: Record<string, any> = { max_count: pageSize };
        if (cursor) body.cursor = cursor;

        console.log(`📤 Fetching videos (page: ${Math.floor(collected.length / 20) + 1})`);
        console.log(`   Request body: ${JSON.stringify(body)}`);
        console.log(`   Fields in URL query: ${fields}`);

        const response = await axios.post(
          `${TIKTOK_API_BASE}/video/list/?fields=${encodeURIComponent(fields)}`,
          body,
          {
            headers: {
              Authorization: `Bearer ${this.accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        );

        const data = response?.data?.data;
        const videoList = data?.videos ?? [];
        console.log(`✅ Received ${videoList.length} videos`);
        collected.push(...videoList);

        if (!data?.has_more || !data?.cursor) {
          break;
        }
        cursor = data.cursor;
      }
    } catch (err: any) {
      const status = err?.response?.status;
      const tiktokError = err?.response?.data ?? err?.message;
      console.error(`❌ API Error:`, tiktokError);
      console.error(`❌ Request body was:`, err?.config?.data);
      console.error(`❌ Request URL:`, err?.config?.url);
      throw new Error(`TikTok video.list failed (${status ?? 'no-status'}): ${JSON.stringify(tiktokError)}`);
    }

    return collected;
  }
}
