// Stub: filePersistence types (feature-gated)
export const DEFAULT_UPLOAD_CONCURRENCY = 4
export const FILE_COUNT_LIMIT = 100
export const OUTPUTS_SUBDIR = 'outputs'
export type FailedPersistence = { path: string; error: string }
export type FilesPersistedEventData = Record<string, unknown>
export type PersistedFile = { path: string; id: string }
export type TurnStartTime = number
