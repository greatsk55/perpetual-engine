# Zod 스키마 기본값 문제

## 문제
`z.object({ ... })` 안에 `.default()`가 있는 필드들이 있어도, 부모 object 자체에 `.default({})`가 없으면 `z.parse({})`가 실패한다.

## 원인
Zod는 nested object의 default를 자동으로 적용하지 않는다. 부모 레벨에서 해당 키가 undefined이면 "Required" 에러가 발생한다.

## 해결
nested `z.object()`에 `.default({})` 를 추가한다:

```typescript
// Before (실패)
const schema = z.object({
  company: z.object({
    name: z.string().default('My Startup'),
  }),
});

// After (성공)
const schema = z.object({
  company: z.object({
    name: z.string().default('My Startup'),
  }).default({}),  // <-- 이것이 필요
});
```

## 적용 위치
- `src/core/project/config.ts` - projectConfigSchema의 company, product, constraints 객체
