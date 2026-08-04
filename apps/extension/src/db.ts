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
  // 'done' 상태는 두지 않는다 — 전송 성공(202) 시 레코드를 즉시 delete 한다.
  // IndexedDB 에는 실패/전송 중(재시도 대상)인 것만 남는다.
  status: 'sending' | 'failed';
  session: Record<string, unknown>;
  updatedAt: number;
}

export interface MetaRow {
  key: string; // 'extensionKey' | 'currentSession' 등
  value: unknown;
}

// 닫힌 세션의 로컬 사본 — 3일 보관 후 자동 삭제 (사용자 결정).
// 전송 필터에 걸러진 세션까지 전부 남겨, DB 의 LLM 출력과 대조하며
// 세션 분할·필터 기준을 실데이터로 튜닝하는 용도다 (계획서 04장 검증 방법).
export interface ArchivedSession {
  id: string; // session id
  closedAt: number; // epoch ms — 보관 기한 판정 기준
  sent: boolean; // 서버 202 확인 여부
  skipReason: string | null; // 전송 필터 탈락 사유 (통과면 null)
  session: Record<string, unknown>;
}

export class NaDb extends Dexie {
  rawEvents!: EntityTable<RawEvent, 'id'>;
  pending!: EntityTable<PendingSession, 'id'>;
  meta!: EntityTable<MetaRow, 'key'>;
  archive!: EntityTable<ArchivedSession, 'id'>;

  constructor() {
    super('na-extension');
    this.version(1).stores({
      rawEvents: '++id, at',
      pending: 'id, status',
      meta: 'key',
      archive: 'id, closedAt',
    });
  }
}

export const db = new NaDb();
