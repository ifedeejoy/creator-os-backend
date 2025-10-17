import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDiscoveryQueue, type DiscoveryJobData } from './discovery-queue.js';
import { db } from '../db/index.js';
import { creatorDiscoveries } from '../db/schema.js';

export interface EnqueueDiscoveryInput {
  discoveryId?: string;
  hashtag: string;
  limit?: number;
  source?: string;
  username?: string;
  requestedBy?: string;
  metadata?: Record<string, unknown>;
}

export interface EnqueueDiscoveryResult {
  discoveryId: string;
  jobId: string;
}

export async function enqueueDiscoveryJob(input: EnqueueDiscoveryInput): Promise<EnqueueDiscoveryResult> {
  const {
    discoveryId,
    hashtag,
    limit = Number.parseInt(process.env.DISCOVERY_DEFAULT_LIMIT ?? '20', 10),
    username,
    requestedBy,
    metadata,
  } = input;

  const resolvedSource = input.source ?? `hashtag:${hashtag}`;
  const queue = getDiscoveryQueue();

  // Ensure we have a persistent record for UI/status tracking
  const recordId = discoveryId ?? (await createDiscoveryRecord({
    hashtag,
    limit,
    source: resolvedSource,
    username,
    requestedBy,
    metadata,
  }));

  await updateDiscoveryStatus(recordId, {
    status: 'pending',
    hashtag,
    limit,
    requestedBy,
    metadata,
  });

  const jobPayload: DiscoveryJobData = {
    discoveryId: recordId,
    hashtag,
    limit,
    source: resolvedSource,
    requestedBy,
    metadata,
  };

  const job = await queue.add('hashtag-discovery', jobPayload);
  const jobId = job.id;

  if (!jobId) {
    throw new Error('Failed to determine queue job id');
  }

  await appendQueueMetadata(recordId, {
    jobId,
    enqueuedAt: new Date().toISOString(),
  });

  return {
    discoveryId: recordId,
    jobId,
  };
}

async function createDiscoveryRecord(input: {
  hashtag: string;
  limit: number;
  source: string;
  username?: string;
  requestedBy?: string;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const { hashtag, limit, source, username, requestedBy, metadata } = input;

  const identifier = username ?? `discovery-${hashtag}-${Date.now()}-${randomUUID().slice(0, 6)}`;

  const payload = {
    hashtag,
    limit,
    requestedBy,
    metadata,
    createdAt: new Date().toISOString(),
  };

  const [record] = await db
    .insert(creatorDiscoveries)
    .values({
      username: identifier,
      source,
      status: 'pending',
      payload,
    })
    .returning({
      id: creatorDiscoveries.id,
    });

  if (!record) {
    throw new Error('Failed to create discovery record');
  }

  return record.id;
}

async function updateDiscoveryStatus(
  recordId: string,
  data: {
    status: 'pending' | 'processing' | 'completed' | 'failed';
    hashtag: string;
    limit: number;
    requestedBy?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const existing = await db
    .select({
      payload: creatorDiscoveries.payload,
    })
    .from(creatorDiscoveries)
    .where(eq(creatorDiscoveries.id, recordId))
    .limit(1);

  const basePayload = existing[0]?.payload ?? {};

  await db
    .update(creatorDiscoveries)
    .set({
      status: data.status,
      attempts: 0,
      payload: {
        ...basePayload,
        hashtag: data.hashtag,
        limit: data.limit,
        requestedBy: data.requestedBy,
        metadata: data.metadata,
        statusUpdatedAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    })
    .where(eq(creatorDiscoveries.id, recordId));
}

async function appendQueueMetadata(
  recordId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const existing = await db
    .select({
      payload: creatorDiscoveries.payload,
    })
    .from(creatorDiscoveries)
    .where(eq(creatorDiscoveries.id, recordId))
    .limit(1);

  const basePayload =
    (existing[0]?.payload as Record<string, unknown> | undefined) ?? {};
  const existingQueue =
    (basePayload['queue'] as Record<string, unknown> | undefined) ?? {};

  await db
    .update(creatorDiscoveries)
    .set({
      payload: {
        ...basePayload,
        queue: {
          ...existingQueue,
          ...metadata,
        },
      },
      updatedAt: new Date(),
    })
    .where(eq(creatorDiscoveries.id, recordId));
}
