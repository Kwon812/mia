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

/**
 * 압축 **전** 원본 이벤트의 보관본 — 서버 콜드 스토리지로 올려보낼 대기열.
 *
 * 왜 필요한가: 서버에 남는 compressed_log 는 이미 100배 가까이 손실된 요약이다
 * (MAX_QUERIES=15, MAX_SEGMENT_PATHS=3, 제목 200자 절단, 도메인 단위 구간 병합).
 * 그건 Haiku 프롬프트 입력이라 작을수록 좋은 값이고, 앞으로도 작게 유지한다.
 * 하지만 "나라는 데이터"를 1년 모으는 관점에서는 그 아래 원본이 유일하게
 * 모델 해석이 안 섞인 기록이다 — experiences·dialogues·daily_logs 는 전부 LLM
 * 생성물이라 학습에 재사용하면 그 모델을 복제할 뿐이다.
 *
 * 왜 새 테이블인가: rawEvents 는 draft 에 흡수되는 즉시 지워진다(sw.ts). 세션이
 * 닫힐 때쯤이면 원본은 이미 수십 번 삭제된 뒤라 "마감 시점에 한 벌 보내기"가
 * 성립하지 않는다. 그래서 **삭제를 이동으로 바꾼다.**
 *
 * 보관은 3일 — archive 와 같은 기준이다. 그 안에 업로드가 성공하면 역할이 끝나고,
 * 실패하면 retry 알람이 10분마다 다시 시도한다.
 */
export interface ArchivedRawEvent {
  id?: number;
  /** 이 이벤트가 흡수된 세션. 아직 어느 세션에도 안 붙었으면 빈 문자열.
   *  null 을 쓰지 않는 이유: Dexie(IndexedDB)는 null 을 인덱싱하지 않아
   *  where('sessionId').equals(null) 로 미배정분을 못 찾는다. */
  sessionId: string;
  at: number; // epoch ms
  kind: string;
  domain: string;
  payload: Record<string, unknown>;
  /** 서버 업로드 완료 여부. 불리언이 아니라 0|1 인 것도 같은 이유 — 인덱싱된다. */
  uploaded: 0 | 1;
}

export class NaDb extends Dexie {
  rawEvents!: EntityTable<RawEvent, 'id'>;
  pending!: EntityTable<PendingSession, 'id'>;
  meta!: EntityTable<MetaRow, 'key'>;
  archive!: EntityTable<ArchivedSession, 'id'>;
  rawArchive!: EntityTable<ArchivedRawEvent, 'id'>;

  constructor() {
    super('na-extension');
    this.version(1).stores({
      rawEvents: '++id, at',
      pending: 'id, status',
      meta: 'key',
      archive: 'id, closedAt',
    });
    // v2 — rawArchive 추가. 기존 테이블은 그대로 두므로 업그레이드 함수가 필요 없다
    // (Dexie 는 선언되지 않은 테이블을 유지하지 않으니 전부 다시 적는다).
    this.version(2).stores({
      rawEvents: '++id, at',
      pending: 'id, status',
      meta: 'key',
      archive: 'id, closedAt',
      rawArchive: '++id, at, sessionId, uploaded',
    });
  }
}

export const db = new NaDb();
