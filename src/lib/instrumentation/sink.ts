import "server-only";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { LibrarySnapshot, RecommendationImpression, RecommendationInteraction } from "./events";

/**
 * Stage 1 이벤트 저장 (docs/STAGE1_INSTRUMENTATION.md).
 *
 * 인터페이스 뒤에 백엔드를 숨긴다 — 기본은 no-op(opt-out). 배포용 저장소(DB/객체 스토리지)는
 * 이 인터페이스를 구현해 교체하며, 스키마·인터페이스만 이 단계에서 동결한다.
 */
export interface InstrumentationSink {
  recordSnapshot(event: LibrarySnapshot): Promise<void>;
  recordImpression(event: RecommendationImpression): Promise<void>;
  recordInteraction(event: RecommendationInteraction): Promise<void>;
}

/** 기본값: 미동의·opt-out 상태. 아무것도 기록하지 않는다. */
export class NullSink implements InstrumentationSink {
  async recordSnapshot(): Promise<void> {}
  async recordImpression(): Promise<void> {}
  async recordInteraction(): Promise<void> {}
}

/**
 * 개발 검증용 append-only JSONL sink. gitignore된 런타임 디렉터리에 쓴다.
 * ephemeral 컨테이너에서는 재활용 시 사라지므로 로컬 검증 전용 — 프로덕션 저장소가 아니다.
 * 원시 라이브러리·이벤트는 절대 VCS에 커밋하지 않는다.
 */
export class JsonlSink implements InstrumentationSink {
  constructor(private readonly dir: string) {}

  private async append(file: string, event: unknown): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await appendFile(join(this.dir, file), JSON.stringify(event) + "\n", "utf8");
  }

  recordSnapshot(event: LibrarySnapshot): Promise<void> {
    return this.append("snapshots.jsonl", event);
  }
  recordImpression(event: RecommendationImpression): Promise<void> {
    return this.append("impressions.jsonl", event);
  }
  recordInteraction(event: RecommendationInteraction): Promise<void> {
    return this.append("interactions.jsonl", event);
  }
}

/**
 * opt-in 게이트. INSTRUMENTATION_ENABLED=1 일 때만 실제 sink를 돌려주고, 그 외에는 NullSink.
 * 동의 없이는 어떤 이벤트도 기록되지 않는다.
 */
export function getSink(): InstrumentationSink {
  if (process.env.INSTRUMENTATION_ENABLED !== "1") return new NullSink();
  const dir = process.env.INSTRUMENTATION_DIR || join(process.cwd(), ".instrumentation");
  return new JsonlSink(dir);
}

/** 가명화 salt — 전용 값 우선, 없으면 세션 비밀 재사용(둘 다 없으면 호출부에서 검증 실패). */
export function instrumentationSalt(): string {
  return process.env.INSTRUMENTATION_SALT || process.env.SESSION_SECRET || "";
}
