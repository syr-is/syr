import { z } from "zod";
import { BaseEntitySchema } from "./common.js";

/**
 * Event Types
 * Types of events that can be emitted by integrated services
 */
export const EventTypeSchema = z.enum([
  "post.created",
  "post.updated",
  "post.deleted",
  "comment.created",
  "comment.updated",
  "comment.deleted",
  "like.created",
  "like.deleted",
  "follow.created",
  "follow.deleted",
  "share.created",
  "user.updated",
  "content.viewed",
]);

export type EventType = z.infer<typeof EventTypeSchema>;

/**
 * Base Event Schema
 * Common fields for all events
 */
export const BaseEventSchema = z.object({
  event_id: z.uuid(),
  event_type: EventTypeSchema,
  user_id: z.string(),
  timestamp: z.iso.datetime(),
  source: z.object({
    service_name: z.string(),
    service_id: z.string(),
    client_id: z.string(),
  }),
});

/**
 * Post Event Data Schema
 */
export const PostEventDataSchema = z.object({
  post_id: z.string(),
  content: z.string().optional(),
  title: z.string().optional(),
  url: z.url().optional(),
  media: z
    .array(
      z.object({
        type: z.enum(["image", "video", "audio", "document"]),
        url: z.url(),
        mime_type: z.string().optional(),
      })
    )
    .optional(),
  tags: z.array(z.string()).optional(),
  visibility: z.enum(["public", "unlisted", "private"]).optional(),
});

export type PostEventData = z.infer<typeof PostEventDataSchema>;

/**
 * Comment Event Data Schema
 */
export const CommentEventDataSchema = z.object({
  comment_id: z.string(),
  post_id: z.string(),
  parent_comment_id: z.string().optional(),
  content: z.string(),
  url: z.url().optional(),
});

export type CommentEventData = z.infer<typeof CommentEventDataSchema>;

/**
 * Interaction Event Data Schema
 */
export const InteractionEventDataSchema = z.object({
  target_id: z.string(),
  target_type: z.enum(["post", "comment", "user"]),
  target_url: z.url().optional(),
});

export type InteractionEventData = z.infer<typeof InteractionEventDataSchema>;

/**
 * Content View Event Data Schema
 */
export const ContentViewEventDataSchema = z.object({
  content_id: z.string(),
  content_type: z.enum(["post", "video", "article", "profile"]),
  duration_seconds: z.number().int().nonnegative().optional(),
  completion_percentage: z.number().min(0).max(100).optional(),
});

export type ContentViewEventData = z.infer<typeof ContentViewEventDataSchema>;

/**
 * Event Schema
 * Complete event with data
 */
export const EventSchema = BaseEventSchema.and(
  z.object({
    data: z.union([
      PostEventDataSchema,
      CommentEventDataSchema,
      InteractionEventDataSchema,
      ContentViewEventDataSchema,
      z.record(z.string(), z.any()),
    ]),
  })
);

export type Event = z.infer<typeof EventSchema>;

/**
 * Event Emission Request Schema
 * For API requests to emit events
 */
export const EventEmissionRequestSchema = z.object({
  event_type: EventTypeSchema,
  user_id: z.string(),
  data: z.record(z.string(), z.any()),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type EventEmissionRequest = z.infer<typeof EventEmissionRequestSchema>;

/**
 * Event Emission Response Schema
 */
export const EventEmissionResponseSchema = z.object({
  event_id: z.uuid(),
  proof_id: z.uuid().optional(),
  credential_id: z.uuid().optional(),
  timestamp: z.iso.datetime(),
  message: z.string(),
});

export type EventEmissionResponse = z.infer<typeof EventEmissionResponseSchema>;

/**
 * Stored Event Schema
 * Internal representation in SurrealDB
 */
export const StoredEventSchema = BaseEntitySchema.pick({
  id: true,
  created_at: true,
}).extend({
  event_id: z.uuid(),
  event_type: EventTypeSchema,
  user_id: z.uuid(),
  client_id: z.string(),
  data: z.record(z.string(), z.any()),
  metadata: z.record(z.string(), z.any()).optional(),
  proof_id: z.uuid().optional(),
});

export type StoredEvent = z.infer<typeof StoredEventSchema>;

/**
 * Event Filter Schema
 * For querying events
 */
export const EventFilterSchema = z.object({
  event_types: z.array(EventTypeSchema).optional(),
  user_id: z.uuid().optional(),
  client_id: z.string().optional(),
  from_date: z.iso.datetime().optional(),
  to_date: z.iso.datetime().optional(),
  limit: z.number().int().positive().max(100).default(20),
  offset: z.number().int().nonnegative().default(0),
});

export type EventFilter = z.infer<typeof EventFilterSchema>;
