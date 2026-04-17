import type { AgentRole, AgentSkill } from './agent-types.js';

/**
 * 에이전트 역할별 기본 스킬 매핑.
 * 각 에이전트는 자신의 역할에 맞는 스킬만 사용할 수 있다.
 */
export const DEFAULT_AGENT_SKILLS: Record<Exclude<AgentRole, 'custom'>, AgentSkill[]> = {
  ceo: [
    {
      name: 'launch-strategy',
      description: '제품 런칭 전략 수립 - 단계별 출시 계획, 채널 전략, 런칭 모멘텀 유지',
      when_to_use: '새 제품/기능 런칭을 계획하거나 go-to-market 전략이 필요할 때',
    },
    {
      name: 'marketing-psychology',
      description: '행동 심리학 기반 의사결정 - 70+ 멘탈 모델로 사용자 행동 예측',
      when_to_use: '사용자 행동 예측, 가격 전략, 포지셔닝 등 심리학 기반 판단이 필요할 때',
    },
    {
      name: 'seo-audit',
      description: 'SEO 감사 - 기술적 SEO 이슈 진단 및 검색 노출 최적화',
      when_to_use: '웹사이트의 검색 엔진 최적화 상태를 점검해야 할 때',
    },
  ],

  cto: [
    {
      name: 'security-review',
      description: '보안 리뷰 - 현재 브랜치 변경사항의 보안 취약점 분석',
      when_to_use: '코드 변경 후 배포 전 보안 점검이 필요할 때',
    },
    {
      name: 'claude-api',
      description: 'Claude API/SDK 앱 빌드 - 프롬프트 캐싱, 도구 사용, 배치 처리 최적화',
      when_to_use: 'AI 기능을 구현하거나 Claude API를 사용하는 코드를 작성할 때',
    },
    {
      name: 'vercel-react-best-practices',
      description: 'React/Next.js 성능 최적화 - Vercel 엔지니어링 가이드라인 기반',
      when_to_use: 'React/Next.js 코드를 작성하거나 성능을 최적화할 때',
    },
    {
      name: 'simplify',
      description: '코드 품질 리뷰 - 재사용성, 품질, 효율성 검토 후 개선',
      when_to_use: '구현 완료 후 코드 품질을 높이고 싶을 때',
    },
  ],

  po: [
    {
      name: 'copywriting',
      description: '마케팅 카피 작성 - 홈페이지, 랜딩페이지, 기능 페이지 등의 카피',
      when_to_use: '제품 페이지의 카피를 작성하거나 개선해야 할 때',
    },
    {
      name: 'marketing-psychology',
      description: '행동 심리학 기반 기획 - 사용자 의사결정 패턴 분석',
      when_to_use: '사용자 행동을 이해하고 기능 기획에 심리학 원리를 적용할 때',
    },
    {
      name: 'web-design-guidelines',
      description: 'UI 가이드라인 검토 - 접근성, UX 모범 사례 확인',
      when_to_use: 'UI 기획안이 웹 인터페이스 가이드라인에 부합하는지 확인할 때',
    },
  ],

  designer: [
    {
      name: 'frontend-design',
      description: '프론트엔드 디자인 구현 - 프로덕션급 UI 컴포넌트 생성',
      when_to_use: '웹 컴포넌트, 페이지, 대시보드 등의 UI를 구현할 때',
    },
    {
      name: 'web-design-guidelines',
      description: 'UI 코드 리뷰 - 접근성, 디자인 모범 사례 준수 확인',
      when_to_use: 'UI 코드가 웹 인터페이스 가이드라인에 맞는지 검토할 때',
    },
  ],

  qa: [
    {
      name: 'security-review',
      description: '보안 리뷰 - 변경사항의 보안 취약점 분석',
      when_to_use: '배포 전 보안 관점에서 코드를 검토할 때',
    },
    {
      name: 'audit-website',
      description: '웹사이트 감사 - SEO, 성능, 보안, 콘텐츠 등 150+ 규칙으로 진단',
      when_to_use: '배포된 웹사이트/앱의 전반적 품질을 점검할 때',
    },
  ],

  marketer: [
    {
      name: 'paid-ads',
      description: '유료 광고 캠페인 - Google Ads, Meta, LinkedIn 등 PPC 전략',
      when_to_use: '유료 광고 캠페인을 기획하거나 최적화할 때',
    },
    {
      name: 'seo-audit',
      description: 'SEO 감사 - 기술적 SEO 이슈 진단',
      when_to_use: '검색 엔진 최적화 상태를 점검하고 개선할 때',
    },
    {
      name: 'copywriting',
      description: '마케팅 카피 작성 - 모든 종류의 마케팅 페이지 카피',
      when_to_use: '마케팅 콘텐츠, 랜딩페이지, 광고 카피를 작성할 때',
    },
    {
      name: 'launch-strategy',
      description: '런칭 전략 - 제품/기능 출시 계획 수립',
      when_to_use: '제품 런칭이나 기능 출시 전략을 세울 때',
    },
    {
      name: 'marketing-psychology',
      description: '마케팅 심리학 - 소비자 행동과학 기반 전략',
      when_to_use: '소비자 심리를 활용한 마케팅 전략이 필요할 때',
    },
    {
      name: 'google-ads-manager',
      description: 'Google Ads 관리 - 캠페인 설정, 키워드 리서치, 입찰 최적화',
      when_to_use: 'Google Ads 캠페인을 설정하거나 성과를 분석할 때',
    },
  ],
};

/** 역할에 맞는 기본 스킬 목록 반환 */
export function getSkillsForRole(role: AgentRole): AgentSkill[] {
  if (role === 'custom') return [];
  return DEFAULT_AGENT_SKILLS[role] ?? [];
}
