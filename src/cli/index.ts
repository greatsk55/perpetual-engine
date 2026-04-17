import { Command } from 'commander';
import { registerInitCommand } from './commands/init.js';
import { registerSetupCommand } from './commands/setup.js';
import { registerTeamCommand } from './commands/team.js';
import { registerStartCommand } from './commands/start.js';
import { registerStopCommand } from './commands/stop.js';
import { registerStatusCommand } from './commands/status.js';
import { registerBoardCommand } from './commands/board.js';
import { registerMessageCommand } from './commands/message.js';
import { registerPauseCommand } from './commands/pause.js';
import { registerResumeCommand } from './commands/resume.js';
import { registerSprintCommand } from './commands/sprint.js';
import { registerLogsCommand } from './commands/logs.js';
import { registerAgentCommand } from './commands/agent.js';
import { registerTaskCommand } from './commands/task.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('perpetual-engine')
    .description('AI 에이전트 스타트업 프레임워크 - 토큰만 투자하면 AI가 사업을 만든다')
    .version('0.1.0');

  // 프로젝트 관리
  registerInitCommand(program);
  registerSetupCommand(program);
  registerStartCommand(program);
  registerStopCommand(program);

  // 에이전트 관리
  registerTeamCommand(program);
  registerAgentCommand(program);

  // 태스크 제어
  registerTaskCommand(program);

  // 사용자 개입
  registerStatusCommand(program);
  registerBoardCommand(program);
  registerMessageCommand(program);
  registerPauseCommand(program);
  registerResumeCommand(program);
  registerSprintCommand(program);
  registerLogsCommand(program);

  return program;
}
