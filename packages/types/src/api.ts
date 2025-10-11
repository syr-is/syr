import { z } from "zod";

/**
 * API Response Status Schema
 */
export const APIStatusSchema = z.enum(["success", "error"]);
export type APIStatus = z.infer<typeof APIStatusSchema>;

/**
 * Generic API Response Schema
 */
export const APIResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    status: APIStatusSchema,
    data: dataSchema.optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z.record(z.string(), z.any()).optional(),
      })
      .optional(),
    meta: z
      .object({
        timestamp: z.iso.datetime(),
        request_id: z.uuid().optional(),
      })
      .optional(),
  });

/**
 * Pagination Schema
 */
export const PaginationSchema = z.object({
  limit: z.number().int().positive().max(100).default(20),
  offset: z.number().int().nonnegative().default(0),
  total: z.number().int().nonnegative().optional(),
  has_more: z.boolean().optional(),
});

export type Pagination = z.infer<typeof PaginationSchema>;

/**
 * Paginated Response Schema
 */
export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(
  itemSchema: T
) =>
  z.object({
    status: APIStatusSchema,
    data: z.array(itemSchema),
    pagination: PaginationSchema,
    meta: z
      .object({
        timestamp: z.iso.datetime(),
        request_id: z.uuid().optional(),
      })
      .optional(),
  });

/**
 * Error Codes
 */
export const ErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "AUTHENTICATION_ERROR",
  "AUTHORIZATION_ERROR",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMIT_EXCEEDED",
  "INTERNAL_SERVER_ERROR",
  "SERVICE_UNAVAILABLE",
  "BAD_REQUEST",
  "FORBIDDEN",
  "INVALID_CREDENTIALS",
  "TOKEN_EXPIRED",
  "INVALID_TOKEN",
  "INSUFFICIENT_PERMISSIONS",
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/**
 * API Error Schema
 */
export const APIErrorSchema = z.object({
  status: z.literal("error"),
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.any()).optional(),
    field_errors: z
      .record(
        z.string(),
        z.array(
          z.object({
            message: z.string(),
            code: z.string().optional(),
          })
        )
      )
      .optional(),
  }),
  meta: z.object({
    timestamp: z.iso.datetime(),
    request_id: z.uuid().optional(),
  }),
});

export type APIError = z.infer<typeof APIErrorSchema>;

/**
 * Health Check Response Schema
 */
export const HealthCheckResponseSchema = z.object({
  status: z.enum(["healthy", "degraded", "unhealthy"]),
  timestamp: z.iso.datetime(),
  version: z.string(),
  services: z.object({
    database: z.enum(["up", "down"]),
    cache: z.enum(["up", "down"]).optional(),
  }),
});

export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>;

/**
 * Sort Order Schema
 */
export const SortOrderSchema = z.enum(["asc", "desc"]);
export type SortOrder = z.infer<typeof SortOrderSchema>;

/**
 * Sort Schema
 */
export const SortSchema = z.object({
  field: z.string(),
  order: SortOrderSchema.default("desc"),
});

export type Sort = z.infer<typeof SortSchema>;

/**
 * Query Options Schema
 * Common query options for list endpoints
 */
export const QueryOptionsSchema = z.object({
  limit: z.number().int().positive().max(100).default(20),
  offset: z.number().int().nonnegative().default(0),
  sort: SortSchema.optional(),
  search: z.string().optional(),
  filters: z.record(z.string(), z.any()).optional(),
});

export type QueryOptions = z.infer<typeof QueryOptionsSchema>;

/**
 * Batch Operation Request Schema
 */
export const BatchOperationRequestSchema = z.object({
  operations: z.array(
    z.object({
      id: z.uuid(),
      operation: z.enum(["create", "update", "delete"]),
      data: z.record(z.string(), z.any()).optional(),
    })
  ),
});

export type BatchOperationRequest = z.infer<typeof BatchOperationRequestSchema>;

/**
 * Batch Operation Response Schema
 */
export const BatchOperationResponseSchema = z.object({
  status: APIStatusSchema,
  results: z.array(
    z.object({
      id: z.uuid(),
      success: z.boolean(),
      error: z.string().optional(),
    })
  ),
  meta: z.object({
    total: z.number().int().nonnegative(),
    successful: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
});

export type BatchOperationResponse = z.infer<
  typeof BatchOperationResponseSchema
>;

/**
 * Upload Response Schema
 */
export const UploadResponseSchema = z.object({
  status: APIStatusSchema,
  data: z.object({
    file_id: z.uuid(),
    file_name: z.string(),
    file_size: z.number().int().positive(),
    mime_type: z.string(),
    url: z.url(),
    thumbnail_url: z.url().optional(),
  }),
});

export type UploadResponse = z.infer<typeof UploadResponseSchema>;
