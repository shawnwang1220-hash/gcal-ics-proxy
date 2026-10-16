CREATE TABLE IF NOT EXISTS calendars (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    color TEXT DEFAULT '#3b82f6',
    timezone TEXT DEFAULT 'UTC',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    sync_token INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS calendar_objects (
    id TEXT PRIMARY KEY,
    calendar_id TEXT NOT NULL,
    uid TEXT NOT NULL,
    etag TEXT NOT NULL,
    content_type TEXT DEFAULT 'text/calendar',
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    -- 以下三列用于「单向往 Google 推送」
    synced_at INTEGER,                          -- 推送成功的时间戳；NULL = 尚未推送
    gcal_event_id TEXT,                         -- Google 侧事件 ID，推送成功后回填
    push_attempts INTEGER NOT NULL DEFAULT 0,   -- 推送失败次数，达到上限后不再重试
    FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_calendar_objects_calendar_id ON calendar_objects(calendar_id);
CREATE INDEX IF NOT EXISTS idx_calendar_objects_uid ON calendar_objects(uid);
CREATE INDEX IF NOT EXISTS idx_calendar_objects_synced ON calendar_objects(synced_at);

INSERT OR IGNORE INTO calendars (id, name, display_name, description, created_at, updated_at)
VALUES ('default', 'default', 'Default Calendar', 'Default calendar for CalDAV',
        unixepoch(), unixepoch());
