export interface TikTokUserInfo {
  open_id: string;
  union_id: string;
  display_name: string;
  avatar_url: string;
  bio_description: string;
  follower_count: number;
  following_count: number;
  likes_count: number;
  video_count: number;
}

export interface TikTokVideo {
  id: string;
  create_time: number;
  cover_image_url: string;
  share_url: string;
  video_description: string;
  duration: number;
  height: number;
  width: number;
  title: string;
  embed_html: string;
  embed_link: string;
  like_count: number;
  comment_count: number;
  share_count: number;
  view_count: number;
}

export interface SyncResult {
  userInfo: TikTokUserInfo;
  videosCount: number;
}

export interface ITikTokClient {
  getUserInfo(): Promise<TikTokUserInfo>;
  getUserVideos(totalDesired: number): Promise<TikTokVideo[]>;
}

export interface ITikTokRepository {
  getUserTokens(userId: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date | null }>;
  updateUserProfile(userId: string, userInfo: TikTokUserInfo): Promise<void>;
  upsertVideos(userId: string, videos: TikTokVideo[]): Promise<number>;
}

export interface ITikTokService {
  syncUserData(userId: string): Promise<SyncResult>;
}
