/**
 * 메트릭스 기반 기획 평가 시스템 타입 정의.
 *
 * 모든 아이디에이션/기획은 반드시:
 * 1. 측정 지표(KPI)와 목표치를 설정하고
 * 2. 측정 기간을 정의하고
 * 3. 기간 종료 후 달성 여부를 수치화하여
 * 4. 개선/유지/폐기 판단을 내린다
 */

/** 측정 지표 하나의 정의 */
export interface MetricDefinition {
  /** 지표 이름 (예: "DAU", "전환율", "페이지 로드 시간") */
  name: string;
  /** 측정 단위 (예: "명", "%", "ms", "건") */
  unit: string;
  /** 측정 시작 시점의 기준값 (baseline) */
  baseline: number;
  /** 목표값 */
  target: number;
  /** 목표 방향: higher = 높을수록 좋음, lower = 낮을수록 좋음 */
  direction: 'higher' | 'lower';
}

/** 측정 결과 */
export interface MetricResult {
  /** 지표 이름 (MetricDefinition.name과 매칭) */
  name: string;
  /** 실제 달성값 */
  actual: number;
  /** 달성률 (0~100+, 100 = 목표 달성) */
  achievement_rate: number;
}

/** 평가 판정 결과 */
export type EvaluationVerdict =
  | 'exceeded'   // 목표 초과 달성 (>=120%)
  | 'achieved'   // 목표 달성 (>=100%)
  | 'improving'  // 개선 중이나 미달 (>=60%)
  | 'stagnant'   // 정체 (>=30%)
  | 'failed';    // 실패 (<30%)

/** 평가 후 다음 행동 */
export type EvaluationAction =
  | 'scale_up'    // 확대: 목표 초과 시 더 투자
  | 'maintain'    // 유지: 목표 달성 시 현상 유지
  | 'iterate'     // 반복개선: 방향은 맞으나 부족할 때
  | 'pivot'       // 방향전환: 정체 시 접근법 변경
  | 'kill';       // 폐기: 완전 실패 시 중단

/** 기획 하나에 대한 메트릭스 계획 */
export interface MetricsPlan {
  /** 이 기획의 가설 (예: "온보딩 개선 시 7일 리텐션이 20% 상승할 것") */
  hypothesis: string;
  /** 측정 지표 목록 */
  metrics: MetricDefinition[];
  /** 측정 시작일 (ISO 8601) */
  measurement_start: string;
  /** 측정 종료일 (ISO 8601) */
  measurement_end: string;
  /** 중간 체크포인트 (ISO 8601 날짜 배열) */
  checkpoints: string[];
}

/** 평가 결과 */
export interface MetricsEvaluation {
  /** 평가 ID */
  id: string;
  /** 연결된 태스크 ID */
  task_id: string;
  /** 평가 일자 */
  evaluated_at: string;
  /** 중간 평가인지 최종 평가인지 */
  type: 'checkpoint' | 'final';
  /** 각 지표별 결과 */
  results: MetricResult[];
  /** 종합 달성률 (가중 평균) */
  overall_achievement: number;
  /** 판정 */
  verdict: EvaluationVerdict;
  /** 다음 행동 */
  action: EvaluationAction;
  /** 판단 근거 및 다음 단계 설명 */
  reasoning: string;
}

/** 태스크에 부착되는 메트릭스 정보 */
export interface TaskMetrics {
  /** 메트릭스 계획 */
  plan: MetricsPlan;
  /** 평가 이력 (checkpoint + final) */
  evaluations: MetricsEvaluation[];
}

/** 메트릭스 저장소 파일 구조 */
export interface MetricsStore {
  /** 태스크 ID → 메트릭스 매핑 */
  tasks: Record<string, TaskMetrics>;
}
