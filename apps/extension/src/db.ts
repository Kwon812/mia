import Dexie, { type EntityTable } from 'dexie';

// 서비스 워커는 메모리에 아무것도 남기면 안 된다 (30초 유휴 시 종료됨).
// 모든 상태는 여기, IndexedDB(Dexie)에 저장한다.

export interface RawEvent {
  id?: number;
  at: number; // epoch ms
  kind: string; // 'activity' | 'tab_activated' | 'tab_updated' 등
  domain: string;
  payload: Record<string, unknown>;
}

export interface PendingSession {
  id: string; // session id
  status: 'sending' | 'failed' | 'done';
  session: Record<string, unknown>;
  updatedAt: number;
}

export interface MetaRow {
  key: string; // 'extensionKey' | 'currentSession' 등
  value: unknown;
}

export class NaDb extends Dexie {
  rawEvents!: EntityTable<RawEvent, 'id'>;
  pending!: EntityTable<PendingSession, 'id'>;
  meta!: EntityTable<MetaRow, 'key'>;

  constructor() {
    super('na-extension');
    this.version(1).stores({
      rawEvents: '++id, at',
      pending: 'id, status',
      meta: 'key',
    });
  }
}

export const db = new NaDb();
