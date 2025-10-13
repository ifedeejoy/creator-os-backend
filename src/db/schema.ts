import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  decimal,
  timestamp,
  jsonb,
  bigint,
  date,
  index,
} from 'drizzle-orm/pg-core';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tiktokId: varchar('tiktok_id', { length: 100 }).unique().notNull(),
    username: varchar('username', { length: 255 }).notNull(),
    displayName: varchar('display_name', { length: 255 }),
    avatarUrl: text('avatar_url'),
    followerCount: integer('follower_count'),
    followingCount: integer('following_count'),
    totalLikes: bigint('total_likes', { mode: 'number' }),
    bio: text('bio'),
    accessTokenEncrypted: text('access_token_encrypted'),
    refreshTokenEncrypted: text('refresh_token_encrypted'),
    tokenExpiresAt: timestamp('token_expires_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    usernameIdx: index('username_idx').on(table.username),
  }),
);

export const videos = pgTable(
  'videos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    tiktokVideoId: varchar('tiktok_video_id', { length: 100 }).unique().notNull(),
    description: text('description'),
    viewCount: integer('view_count').default(0),
    likeCount: integer('like_count').default(0),
    commentCount: integer('comment_count').default(0),
    shareCount: integer('share_count').default(0),
    engagementRate: decimal('engagement_rate', { precision: 5, scale: 2 }),
    videoCreatedAt: timestamp('video_created_at'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    userIdx: index('videos_user_idx').on(table.userId),
    engagementIdx: index('videos_engagement_idx').on(table.engagementRate),
  }),
);

export const dailyMetrics = pgTable(
  'daily_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    date: date('date').notNull(),
    totalViews: integer('total_views').default(0),
    totalLikes: integer('total_likes').default(0),
    totalComments: integer('total_comments').default(0),
    totalShares: integer('total_shares').default(0),
    followerCount: integer('follower_count'),
    avgEngagementRate: decimal('avg_engagement_rate', { precision: 5, scale: 2 }),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    userDateIdx: index('metrics_user_date_idx').on(table.userId, table.date),
  }),
);

export const creators = pgTable(
  'creators',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tiktokId: varchar('tiktok_id', { length: 100 }).unique().notNull(),
    username: varchar('username', { length: 255 }).notNull(),
    followerCount: integer('follower_count'),
    followingCount: integer('following_count'),
    totalLikes: bigint('total_likes', { mode: 'number' }),
    videoCount: integer('video_count'),
    bio: text('bio'),
    profileData: jsonb('profile_data'),
    lastScrapedAt: timestamp('last_scraped_at'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    usernameIdx: index('creators_username_idx').on(table.username),
    followersIdx: index('creators_followers_idx').on(table.followerCount),
  }),
);

export const creatorDiscoveries = pgTable(
  'creator_discoveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: varchar('username', { length: 255 }).notNull(),
    source: varchar('source', { length: 50 }).default('scraper'),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    payload: jsonb('payload'),
    attempts: integer('attempts').default(0),
    lastAttemptAt: timestamp('last_attempt_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    usernameIdx: index('creator_discoveries_username_idx').on(table.username),
    statusIdx: index('creator_discoveries_status_idx').on(table.status),
  }),
);

export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;

export type Video = InferSelectModel<typeof videos>;
export type NewVideo = InferInsertModel<typeof videos>;

export type DailyMetric = InferSelectModel<typeof dailyMetrics>;
export type NewDailyMetric = InferInsertModel<typeof dailyMetrics>;

export type Creator = InferSelectModel<typeof creators>;
export type NewCreator = InferInsertModel<typeof creators>;

export type CreatorDiscovery = InferSelectModel<typeof creatorDiscoveries>;
export type NewCreatorDiscovery = InferInsertModel<typeof creatorDiscoveries>;
