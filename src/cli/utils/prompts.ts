import { input, select } from '@inquirer/prompts';

/**
 * 에이전트가 응답·문서·커밋 메시지에 사용할 언어 옵션.
 * value: BCP-47 언어 코드 (config 저장용)
 * name: 사용자에게 보이는 표시명
 * promptName: 시스템 프롬프트에 주입될 사람이 읽는 이름 (LLM이 인식하기 좋은 형태)
 */
export const LANGUAGE_CHOICES: ReadonlyArray<{ value: string; name: string; promptName: string }> = [
  { value: 'ko', name: '한국어', promptName: '한국어 (Korean)' },
  { value: 'en', name: 'English', promptName: 'English' },
  { value: 'ja', name: '日本語 (Japanese)', promptName: '日本語 (Japanese)' },
  { value: 'zh-CN', name: '简体中文 (Simplified Chinese)', promptName: '简体中文 (Simplified Chinese)' },
  { value: 'zh-TW', name: '繁體中文 (Traditional Chinese)', promptName: '繁體中文 (Traditional Chinese)' },
  { value: 'es', name: 'Español (Spanish)', promptName: 'Español (Spanish)' },
  { value: 'fr', name: 'Français (French)', promptName: 'Français (French)' },
  { value: 'de', name: 'Deutsch (German)', promptName: 'Deutsch (German)' },
  { value: 'pt', name: 'Português (Portuguese)', promptName: 'Português (Portuguese)' },
  { value: 'vi', name: 'Tiếng Việt (Vietnamese)', promptName: 'Tiếng Việt (Vietnamese)' },
];

/** value → promptName 조회 (config의 language 코드로부터 사람이 읽는 이름을 얻을 때 사용) */
export function resolveLanguageName(code: string): string {
  return LANGUAGE_CHOICES.find((c) => c.value === code)?.promptName ?? code;
}

export interface SetupAnswers {
  language: string;
  languageName: string;
  companyName: string;
  companyMission: string;
  productName: string;
  productDescription: string;
  targetUsers: string;
  coreValue: string;
  techStackPreference: string;
  deployTarget: string;
}

export async function runSetupPrompts(): Promise<SetupAnswers> {
  const language = await select({
    message: '에이전트가 사용할 언어를 선택하세요 (모든 응답·문서·커밋 메시지):',
    choices: LANGUAGE_CHOICES.map(({ value, name }) => ({ value, name })),
    default: 'ko',
  });
  const languageName = resolveLanguageName(language);

  const companyName = await input({
    message: '회사 이름을 입력하세요:',
    default: 'My Startup',
  });

  const companyMission = await input({
    message: '회사의 미션을 입력하세요:',
    default: '',
  });

  const productName = await input({
    message: '프로덕트 이름을 입력하세요:',
    default: 'My Product',
  });

  const productDescription = await input({
    message: '프로덕트 설명을 입력하세요:',
    default: '',
  });

  const targetUsers = await input({
    message: '타겟 사용자를 입력하세요:',
    default: '',
  });

  const coreValue = await input({
    message: '프로덕트의 핵심 가치를 입력하세요:',
    default: '',
  });

  const techStackPreference = await select({
    message: '기술 스택 선호도:',
    choices: [
      { name: '자동 결정 (CTO 에이전트가 결정)', value: 'auto' },
      { name: 'React + Node.js', value: 'react-node' },
      { name: 'Next.js', value: 'nextjs' },
      { name: 'Vue + Express', value: 'vue-express' },
      { name: '직접 지정', value: 'custom' },
    ],
  });

  const deployTarget = await select({
    message: '배포 타겟:',
    choices: [
      { name: 'Vercel', value: 'vercel' },
      { name: 'Netlify', value: 'netlify' },
      { name: 'AWS', value: 'aws' },
      { name: 'GCP', value: 'gcp' },
      { name: '직접 관리', value: 'self-hosted' },
    ],
  });

  return {
    language,
    languageName,
    companyName,
    companyMission,
    productName,
    productDescription,
    targetUsers,
    coreValue,
    techStackPreference,
    deployTarget,
  };
}
