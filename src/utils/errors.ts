export class PerpetualEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PerpetualEngineError';
  }
}

export class ProjectNotFoundError extends PerpetualEngineError {
  constructor(path: string) {
    super(`PerpetualEngine 프로젝트를 찾을 수 없습니다: ${path}`);
    this.name = 'ProjectNotFoundError';
  }
}

export class ConfigError extends PerpetualEngineError {
  constructor(message: string) {
    super(`설정 오류: ${message}`);
    this.name = 'ConfigError';
  }
}

export class TmuxNotFoundError extends PerpetualEngineError {
  constructor() {
    super('tmux가 설치되어 있지 않습니다. brew install tmux 로 설치해주세요.');
    this.name = 'TmuxNotFoundError';
  }
}

export class AgentError extends PerpetualEngineError {
  constructor(agent: string, message: string) {
    super(`에이전트 [${agent}] 오류: ${message}`);
    this.name = 'AgentError';
  }
}
