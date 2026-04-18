import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export type Device = 'mobile' | 'tablet' | 'desktop' | 'slide' | string;

/**
 * 피처 폴더의 meta.json 스키마.
 *
 * 기본(짧은) 형태: 한 피처 1개 화면
 *   { "name","feature","screen","device","title", ... }
 *
 * 확장 형태: 한 피처에 여러 화면 (mobile/tablet/desktop 등)
 *   { "feature":"login", "title":"로그인", "screens": { "mobile.html": { "device":"mobile", ... }, "desktop.html": { ... } } }
 *
 * 파일이 여러 개인데 `screens` 가 없으면, 파일명으로 device 를 추론하고
 * feature/title 등은 피처 레벨 공통으로 사용한다.
 */
export interface MockupMeta {
  name?: string;
  feature?: string;
  screen?: string;
  device?: Device;
  title?: string;
  description?: string;
  flow?: string[];
  tokensUsed?: string[];
  componentsUsed?: string[];
  screens?: Record<string, Partial<Omit<MockupMeta, 'screens'>>>;
}

export interface MockupEntry {
  /** 캔버스 고유 id: `<feature>-<screenName>` */
  id: string;
  feature: string;
  screen: string;
  device: Device;
  name?: string;
  title?: string;
  description?: string;
  flow?: string[];
  tokensUsed?: string[];
  componentsUsed?: string[];
  /** `/design-assets/...` 로 서빙 가능한 HTML 상대 경로 */
  htmlPath: string;
  /** meta.json 상대 경로 */
  metaPath: string;
  /** HTML 파일 마지막 수정 시각 ISO */
  modified: string;
}

/**
 * docs/design/mockups/<feature>/ 하위를 스캔하여 목업 엔트리들을 반환.
 *
 * 규약:
 *  - 피처 폴더 1개 = 여러 화면 가능 (mobile.html + tablet.html + desktop.html 등)
 *  - meta.json 필수 — 없으면 해당 폴더 skip (Design Canvas 에서 사라짐)
 *  - meta.json 의 `screens` 필드로 파일별 메타를 세밀히 지정 가능; 없으면 파일명으로 device 추론
 */
export async function scanMockups(mockupsRoot: string): Promise<MockupEntry[]> {
  let featureDirs: string[];
  try {
    featureDirs = (await readdir(mockupsRoot, { withFileTypes: true }))
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return [];
  }

  const entries: MockupEntry[] = [];

  for (const feature of featureDirs) {
    const featureDir = path.join(mockupsRoot, feature);
    const metaFile = path.join(featureDir, 'meta.json');
    let meta: MockupMeta;
    try {
      const raw = await readFile(metaFile, 'utf-8');
      meta = JSON.parse(raw) as MockupMeta;
    } catch {
      continue;
    }

    let htmlFiles: string[];
    try {
      htmlFiles = (await readdir(featureDir)).filter(f => f.endsWith('.html'));
    } catch {
      continue;
    }
    if (htmlFiles.length === 0) continue;

    // feature 이름은 meta.feature 우선, 없으면 폴더명
    const featureId = meta.feature ?? feature;

    for (const htmlFile of htmlFiles) {
      const screenName = htmlFile.replace(/\.html$/, '');
      const override = meta.screens?.[htmlFile] ?? meta.screens?.[screenName] ?? {};
      const device = override.device ?? inferDevice(screenName) ?? meta.device ?? 'desktop';
      const s = await stat(path.join(featureDir, htmlFile));

      entries.push({
        id: `${feature}-${screenName}`,
        feature: featureId,
        screen: override.screen ?? meta.screen ?? screenName,
        device,
        name: override.name ?? meta.name,
        title: override.title ?? meta.title ?? `${featureId} · ${screenName}`,
        description: override.description ?? meta.description,
        flow: override.flow ?? meta.flow,
        tokensUsed: override.tokensUsed ?? meta.tokensUsed,
        componentsUsed: override.componentsUsed ?? meta.componentsUsed,
        htmlPath: `mockups/${feature}/${htmlFile}`,
        metaPath: `mockups/${feature}/meta.json`,
        modified: s.mtime.toISOString(),
      });
    }
  }

  return entries.sort((a, b) => {
    // system 은 항상 최상단
    if (a.feature === 'system' && b.feature !== 'system') return -1;
    if (b.feature === 'system' && a.feature !== 'system') return 1;
    // 그 외에는 feature 내에서 device 순서 (mobile → tablet → desktop)
    if (a.feature !== b.feature) return a.feature.localeCompare(b.feature);
    return deviceOrder(a.device) - deviceOrder(b.device);
  });
}

function inferDevice(name: string): Device | null {
  const n = name.toLowerCase();
  if (/(^|[-_])(mobile|phone|ios|android)([-_]|$)/.test(n)) return 'mobile';
  if (/(^|[-_])(tablet|ipad)([-_]|$)/.test(n)) return 'tablet';
  if (/(^|[-_])(desktop|web|pc)([-_]|$)/.test(n)) return 'desktop';
  // 슬라이드/피치덱/프레젠테이션 시안
  if (/(^|[-_])(slide|deck|pitch|presentation|keynote)([-_]|$)/.test(n)) return 'slide';
  return null;
}

function deviceOrder(device: Device): number {
  if (device === 'mobile') return 0;
  if (device === 'tablet') return 1;
  if (device === 'desktop') return 2;
  if (device === 'slide') return 3;
  return 4;
}
