import { db } from '../db/index.js';
import { users, videos, dailyMetrics } from '../db/schema.js';

async function seed(): Promise<void> {
  console.log('🌱 Seeding database with mock data...');

  const [user] = await db
    .insert(users)
    .values({
      tiktokId: 'demo_user_123',
      username: 'demo_creator',
      displayName: 'Demo Creator',
      followerCount: 125_000,
      followingCount: 450,
      totalLikes: 3_200_000,
      bio: 'TikTok Shop creator sharing fashion tips & reviews',
    })
    .returning();

  console.log(`✅ Created user: @${user.username}`);

  const mockVideos = [
    {
      userId: user.id,
      tiktokVideoId: 'video_001',
      description: 'Summer fashion haul from TikTok Shop! 🛍️ #tiktokshop',
      viewCount: 523_000,
      likeCount: 45_200,
      commentCount: 1_230,
      shareCount: 890,
      engagementRate: '9.02',
      videoCreatedAt: new Date('2025-10-01'),
    },
    {
      userId: user.id,
      tiktokVideoId: 'video_002',
      description: 'Try-on haul: Affordable basics under $20',
      viewCount: 312_000,
      likeCount: 28_100,
      commentCount: 654,
      shareCount: 421,
      engagementRate: '9.35',
      videoCreatedAt: new Date('2025-10-05'),
    },
    {
      userId: user.id,
      tiktokVideoId: 'video_003',
      description: 'Cozy fall outfit ideas 🍂',
      viewCount: 678_000,
      likeCount: 61_200,
      commentCount: 2_340,
      shareCount: 1_450,
      engagementRate: '9.56',
      videoCreatedAt: new Date('2025-10-08'),
    },
    {
      userId: user.id,
      tiktokVideoId: 'video_004',
      description: 'Amazon vs TikTok Shop: Which is better?',
      viewCount: 891_000,
      likeCount: 73_400,
      commentCount: 3_210,
      shareCount: 2_100,
      engagementRate: '8.83',
      videoCreatedAt: new Date('2025-10-10'),
    },
    {
      userId: user.id,
      tiktokVideoId: 'video_005',
      description: 'My top 5 TikTok Shop finds this month',
      viewCount: 445_000,
      likeCount: 38_900,
      commentCount: 987,
      shareCount: 654,
      engagementRate: '9.11',
      videoCreatedAt: new Date('2025-10-12'),
    },
  ];

  await db.insert(videos).values(mockVideos);
  console.log(`✅ Created ${mockVideos.length} mock videos`);

  const dailyData = Array.from({ length: 7 }).map((_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - index);

    return {
      userId: user.id,
      date: date.toISOString().split('T')[0]!,
      totalViews: Math.floor(200_000 + Math.random() * 100_000),
      totalLikes: Math.floor(15_000 + Math.random() * 10_000),
      totalComments: Math.floor(800 + Math.random() * 500),
      totalShares: Math.floor(400 + Math.random() * 300),
      followerCount: 125_000 + index * 100,
      avgEngagementRate: (8.5 + Math.random() * 1.5).toFixed(2),
    };
  });

  await db.insert(dailyMetrics).values(dailyData);
  console.log(`✅ Created ${dailyData.length} days of metrics`);

  console.log('\n🎉 Seeding complete!\n');
  process.exit(0);
}

seed().catch((error) => {
  console.error('❌ Seeding failed:', error);
  process.exit(1);
});
