import { z } from "zod";
import { BaseEntitySchema } from "./common.js";

/**
 * ActivityPub Actor Types
 */
export const ActorTypeSchema = z.enum([
  "Person",
  "Service",
  "Application",
  "Group",
  "Organization",
]);
export type ActorType = z.infer<typeof ActorTypeSchema>;

/**
 * ActivityPub Public Key Schema
 */
export const PublicKeySchema = z.object({
  id: z.url(),
  owner: z.url(),
  publicKeyPem: z.string(),
});

export type PublicKey = z.infer<typeof PublicKeySchema>;

/**
 * ActivityPub Actor Schema
 * Represents a federated actor (Person, Service, etc.)
 */
export const ActorSchema = z.object({
  "@context": z
    .union([
      z.string(),
      z.array(z.union([z.string(), z.record(z.string(), z.any())])),
    ])
    .optional(),
  id: z.url(),
  type: ActorTypeSchema,
  preferredUsername: z.string(),
  name: z.string().optional(),
  summary: z.string().optional(),
  icon: z
    .object({
      type: z.literal("Image"),
      mediaType: z.string(),
      url: z.url(),
    })
    .optional(),
  image: z
    .object({
      type: z.literal("Image"),
      mediaType: z.string(),
      url: z.url(),
    })
    .optional(),
  inbox: z.url(),
  outbox: z.url(),
  followers: z.url(),
  following: z.url(),
  liked: z.url().optional(),
  publicKey: PublicKeySchema,
  url: z.url().optional(),
  manuallyApprovesFollowers: z.boolean().optional(),
  published: z.iso.datetime().optional(),
});

export type Actor = z.infer<typeof ActorSchema>;

/**
 * ActivityPub Activity Types
 */
export const ActivityTypeSchema = z.enum([
  "Create",
  "Update",
  "Delete",
  "Follow",
  "Accept",
  "Reject",
  "Add",
  "Remove",
  "Like",
  "Announce",
  "Undo",
  "Block",
]);

export type ActivityType = z.infer<typeof ActivityTypeSchema>;

/**
 * ActivityPub Object Types
 */
export const ObjectTypeSchema = z.enum([
  "Note",
  "Article",
  "Image",
  "Video",
  "Document",
  "Page",
]);
export type ObjectType = z.infer<typeof ObjectTypeSchema>;

/**
 * ActivityPub Object Schema
 * Represents content objects (Note, Article, etc.)
 */
export const ObjectSchema = z.object({
  id: z.url().optional(),
  type: ObjectTypeSchema,
  content: z.string(),
  contentMap: z.record(z.string(), z.string()).optional(),
  summary: z.string().optional(),
  inReplyTo: z.url().optional(),
  published: z.iso.datetime().optional(),
  updated: z.iso.datetime().optional(),
  attributedTo: z.url(),
  to: z.union([z.string(), z.array(z.string())]).optional(),
  cc: z.union([z.string(), z.array(z.string())]).optional(),
  bto: z.union([z.string(), z.array(z.string())]).optional(),
  bcc: z.union([z.string(), z.array(z.string())]).optional(),
  attachment: z
    .array(
      z.object({
        type: z.string(),
        mediaType: z.string().optional(),
        url: z.url(),
        name: z.string().optional(),
      })
    )
    .optional(),
  tag: z
    .array(
      z.object({
        type: z.string(),
        name: z.string(),
        href: z.url().optional(),
      })
    )
    .optional(),
  sensitive: z.boolean().optional(),
  url: z.union([z.url(), z.array(z.url())]).optional(),
});

export type APObject = z.infer<typeof ObjectSchema>;

/**
 * ActivityPub Activity Schema
 * Represents activities (Create, Follow, etc.)
 */
export const ActivitySchema = z.object({
  "@context": z
    .union([
      z.string(),
      z.array(z.union([z.string(), z.record(z.string(), z.any())])),
    ])
    .optional(),
  id: z.url(),
  type: ActivityTypeSchema,
  actor: z.url(),
  object: z.union([z.url(), ObjectSchema, z.record(z.string(), z.any())]),
  published: z.iso.datetime().optional(),
  to: z.union([z.string(), z.array(z.string())]).optional(),
  cc: z.union([z.string(), z.array(z.string())]).optional(),
  bto: z.union([z.string(), z.array(z.string())]).optional(),
  bcc: z.union([z.string(), z.array(z.string())]).optional(),
});

export type Activity = z.infer<typeof ActivitySchema>;

/**
 * ActivityPub Collection Schema
 */
export const CollectionSchema = z.object({
  "@context": z.string().optional(),
  id: z.url(),
  type: z.enum(["Collection", "OrderedCollection"]),
  totalItems: z.number().int().nonnegative(),
  first: z.url().optional(),
  last: z.url().optional(),
  items: z.array(z.any()).optional(),
  orderedItems: z.array(z.any()).optional(),
});

export type Collection = z.infer<typeof CollectionSchema>;

/**
 * ActivityPub Collection Page Schema
 */
export const CollectionPageSchema = z.object({
  "@context": z.string().optional(),
  id: z.url(),
  type: z.enum(["CollectionPage", "OrderedCollectionPage"]),
  partOf: z.url(),
  next: z.url().optional(),
  prev: z.url().optional(),
  items: z.array(z.any()).optional(),
  orderedItems: z.array(z.any()).optional(),
});

export type CollectionPage = z.infer<typeof CollectionPageSchema>;

/**
 * WebFinger Link Schema
 * Per RFC 7033 section 4.4.4
 */
export const WebFingerLinkSchema = z.object({
  rel: z.string(), // required - link relation type
  type: z.string().optional(), // media type
  href: z.url().optional(), // target URI
  titles: z.record(z.string(), z.string()).optional(), // language-tagged titles
  properties: z.record(z.string(), z.string().nullable()).optional(), // extension properties
});

export type WebFingerLink = z.infer<typeof WebFingerLinkSchema>;

/**
 * WebFinger Resource Schema
 * Per RFC 7033 section 4.4
 */
export const WebFingerResourceSchema = z.object({
  subject: z.string(), // required - URI identifying the entity
  aliases: z.array(z.string()).optional(), // array of URIs
  properties: z.record(z.string(), z.string().nullable()).optional(), // name-value pairs
  links: z.array(WebFingerLinkSchema).optional(), // array of link objects
});

export type WebFingerResource = z.infer<typeof WebFingerResourceSchema>;

/**
 * Database Actor Schema
 * Internal representation of actors in SurrealDB
 */
export const DBActorSchema = BaseEntitySchema.extend({
  user_id: z.uuid(),
  actor_type: ActorTypeSchema,
  inbox_url: z.url(),
  outbox_url: z.url(),
  followers_url: z.url(),
  following_url: z.url(),
  public_key: z.string(),
  private_key: z.string(),
});

export type DBActor = z.infer<typeof DBActorSchema>;

/**
 * Follower Relationship Schema
 */
export const FollowerSchema = BaseEntitySchema.extend({
  actor_id: z.uuid(),
  follower_actor_id: z.uuid(),
  follower_actor_url: z.url(),
  status: z.enum(["pending", "accepted", "rejected"]),
});

export type Follower = z.infer<typeof FollowerSchema>;

/**
 * Following Relationship Schema
 */
export const FollowingSchema = BaseEntitySchema.extend({
  actor_id: z.uuid(),
  following_actor_id: z.uuid(),
  following_actor_url: z.url(),
  status: z.enum(["pending", "accepted", "rejected"]),
});

export type Following = z.infer<typeof FollowingSchema>;

/**
 * Stored Activity Schema
 * Internal representation of activities in SurrealDB
 */
export const StoredActivitySchema = BaseEntitySchema.pick({
  id: true,
  created_at: true,
}).extend({
  activity_id: z.url(),
  actor_id: z.uuid(),
  type: ActivityTypeSchema,
  object: z.record(z.string(), z.any()),
  published: z.iso.datetime(),
  to: z.array(z.string()).optional(),
  cc: z.array(z.string()).optional(),
});

export type StoredActivity = z.infer<typeof StoredActivitySchema>;
