import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { watch } from 'chokidar';
import { KanbanManager } from '../core/state/kanban.js';
import { SprintManager } from '../core/state/sprint.js';
import { AgentRegistry } from '../core/agent/agent-registry.js';
import { SessionManager } from '../core/session/session-manager.js';
import { MessageQueue } from '../core/messaging/message-queue.js';
import { scanMockups } from '../core/design/mockup-scanner.js';
import { loadConfig, saveConfig, type ProjectConfig } from '../core/project/config.js';
import { getProjectPaths } from '../utils/paths.js';
import { logger } from '../utils/logger.js';
import type { Task, TaskStatus } from '../core/state/types.js';
import type { FSWatcher } from 'chokidar';

/**
 * DashboardServer 주입 옵션.
 * 테스트에서 MockTmuxAdapter 가 주입된 SessionManager 를 공유할 때 사용한다.
 */
export interface DashboardServerOptions {
  /** 외부에서 주입하는 SessionManager (tmux 목으로 교체된 버전) */
  sessionManager?: SessionManager;
}

export class DashboardServer {
  private app: express.Application;
  private httpServer: ReturnType<typeof createServer>;
  private wss: WebSocketServer;
  private projectRoot: string;
  private kanban: KanbanManager;
  private sprintManager: SprintManager;
  private agentRegistry: AgentRegistry;
  private sessionManager: SessionManager;
  private messageQueue: MessageQueue;
  private watcher: FSWatcher | null = null;
  private port: number;

  constructor(projectRoot: string, port = 3000, options?: DashboardServerOptions) {
    this.projectRoot = projectRoot;
    this.port = port;

    const paths = getProjectPaths(projectRoot);
    this.kanban = new KanbanManager(paths.kanban);
    this.sprintManager = new SprintManager(paths.sprints);
    this.agentRegistry = new AgentRegistry(paths.agents);
    this.sessionManager = options?.sessionManager ?? new SessionManager();
    this.sessionManager.setProjectRoot(projectRoot);
    this.messageQueue = new MessageQueue(paths.messages);

    this.app = express();
    this.app.use(cors());
    this.app.use(express.json());

    this.httpServer = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.setupRoutes();
    this.setupWebSocket();
  }

  /** 실제 바인딩된 포트 (테스트에서 port=0 으로 자동 할당 받은 경우 사용) */
  getPort(): number {
    const addr = this.httpServer.address();
    if (addr && typeof addr === 'object') return addr.port;
    return this.port;
  }

  private setupRoutes(): void {
    const paths = getProjectPaths(this.projectRoot);

    // Overview / Status
    this.app.get('/api/status', async (_req, res) => {
      try {
        const config = await loadConfig(paths.config);
        const tasks = await this.kanban.getAllTasks();
        const currentSprint = await this.sprintManager.getCurrentSprint();
        const running = await this.sessionManager.getRunningAgents();

        const byStatus: Record<string, number> = {};
        for (const t of tasks) {
          byStatus[t.status] = (byStatus[t.status] || 0) + 1;
        }

        res.json({
          company: config.company,
          product: config.product,
          sprint: currentSprint,
          tasks: { total: tasks.length, by_status: byStatus },
          active_agents: running.length,
          agents_running: running,
        });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // Config
    this.app.get('/api/config', async (_req, res) => {
      try {
        const config = await loadConfig(paths.config);
        res.json(config);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    this.app.put('/api/config', async (req, res) => {
      try {
        const config = req.body as ProjectConfig;
        await saveConfig(paths.config, config);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // Kanban
    this.app.get('/api/kanban', async (_req, res) => {
      try {
        const board = await this.kanban.getBoard();
        res.json(board);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    this.app.get('/api/tasks', async (req, res) => {
      try {
        const { status, assignee, sprint } = req.query;
        const tasks = await this.kanban.getTasks({
          status: status as TaskStatus | undefined,
          assignee: assignee as string | undefined,
          sprint: sprint as string | undefined,
        });
        res.json(tasks);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    this.app.get('/api/tasks/:id', async (req, res) => {
      try {
        const task = await this.kanban.getTask(req.params.id);
        if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

        // 담당 에이전트 로그 가져오기
        let agentLog = '';
        if (task.assignee) {
          const role = task.assignee.toLowerCase();
          try {
            agentLog = await this.sessionManager.getAgentLog(role, 200);
          } catch { /* 세션이 없으면 빈 로그 */ }
        }

        res.json({ ...task, agentLog });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    this.app.patch('/api/tasks/:id/status', async (req, res) => {
      try {
        const { status } = req.body;
        const task = await this.kanban.moveTask(req.params.id, status);
        this.broadcast({ type: 'task_updated', data: task });
        res.json(task);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // 태스크 강제 실행
    this.app.post('/api/tasks/:id/force-run', async (req, res) => {
      try {
        const task = await this.kanban.forceStart(req.params.id);
        this.broadcast({ type: 'task_updated', data: task });
        res.json({ message: `${task.id} 강제 실행`, task });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // 태스크 일시 중단
    this.app.post('/api/tasks/:id/suspend', async (req, res) => {
      try {
        const { reason } = req.body ?? {};
        const task = await this.kanban.suspendTask(req.params.id, reason);
        this.broadcast({ type: 'task_updated', data: task });
        res.json({ message: `${task.id} 일시 중단`, task });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // 태스크 재개
    this.app.post('/api/tasks/:id/resume', async (req, res) => {
      try {
        const task = await this.kanban.resumeTask(req.params.id);
        this.broadcast({ type: 'task_updated', data: task });
        res.json({ message: `${task.id} 재개 → ${task.status}`, task });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // Sprints
    this.app.get('/api/sprints', async (_req, res) => {
      try {
        const store = await this.sprintManager.getSprintStore();
        res.json(store);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // Agents
    this.app.get('/api/agents', async (_req, res) => {
      try {
        await this.agentRegistry.load();
        const agents = this.agentRegistry.getAll();
        const running = await this.sessionManager.getRunningAgents();
        const runningRoles = new Set(running.map(r => r.role));

        const result = agents.map(agent => ({
          ...agent,
          status: runningRoles.has(agent.role) ? 'working' : 'idle',
          current_session: running.find(r => r.role === agent.role) ?? null,
        }));

        res.json(result);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    this.app.get('/api/agents/:role/logs', async (req, res) => {
      try {
        const log = await this.sessionManager.getAgentLog(req.params.role);
        res.json({ role: req.params.role, log });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // Messages
    this.app.get('/api/messages', async (_req, res) => {
      try {
        const messages = await this.messageQueue.getAll();
        res.json(messages);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    this.app.post('/api/messages', async (req, res) => {
      try {
        const { to, content } = req.body;
        const message = await this.messageQueue.send({
          from: 'investor',
          to: to || 'all',
          type: 'directive',
          content,
        });
        this.broadcast({ type: 'new_message', data: message });
        res.json(message);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // Documents (meetings & decisions)
    this.app.get('/api/docs/meetings', async (_req, res) => {
      try {
        const files = await this.listMarkdownFiles(paths.meetings);
        res.json(files);
      } catch (err) {
        res.json([]);
      }
    });

    this.app.get('/api/docs/meetings/:filename', async (req, res) => {
      try {
        const filePath = path.join(paths.meetings, req.params.filename);
        const content = await readFile(filePath, 'utf-8');
        res.json({ filename: req.params.filename, content });
      } catch (err) {
        res.status(404).json({ error: 'File not found' });
      }
    });

    this.app.get('/api/docs/decisions', async (_req, res) => {
      try {
        const files = await this.listMarkdownFiles(paths.decisions);
        res.json(files);
      } catch (err) {
        res.json([]);
      }
    });

    this.app.get('/api/docs/decisions/:filename', async (req, res) => {
      try {
        const filePath = path.join(paths.decisions, req.params.filename);
        const content = await readFile(filePath, 'utf-8');
        res.json({ filename: req.params.filename, content });
      } catch (err) {
        res.status(404).json({ error: 'File not found' });
      }
    });

    // All docs categories
    this.app.get('/api/docs', async (_req, res) => {
      try {
        const categories = ['meetings', 'decisions', 'planning', 'design', 'development', 'marketing', 'vision', 'changelog'];
        const result: Record<string, Array<{ filename: string; modified: string }>> = {};
        for (const cat of categories) {
          const dir = (paths as Record<string, string>)[cat];
          if (dir) {
            result[cat] = await this.listMarkdownFiles(dir);
          }
        }
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    this.app.get('/api/docs/:category/:filename', async (req, res) => {
      try {
        const dir = (paths as Record<string, string>)[req.params.category];
        if (!dir) { res.status(404).json({ error: 'Category not found' }); return; }
        const filePath = path.join(dir, req.params.filename);
        const content = await readFile(filePath, 'utf-8');
        res.json({ filename: req.params.filename, category: req.params.category, content });
      } catch (err) {
        res.status(404).json({ error: 'File not found' });
      }
    });

    // Agent control
    this.app.post('/api/agents/pause-all', async (_req, res) => {
      try {
        await this.agentRegistry.load();
        for (const role of this.agentRegistry.getRoles()) {
          try { await this.sessionManager.pauseAgent(role); } catch { /* skip */ }
        }
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    this.app.post('/api/agents/stop-all', async (_req, res) => {
      try {
        await this.sessionManager.stopAll();
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    this.app.post('/api/agents/:role/stop', async (req, res) => {
      try {
        await this.sessionManager.stopAgent(req.params.role);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // Design Canvas — 목업 목록 API
    this.app.get('/api/design/mockups', async (_req, res) => {
      try {
        const entries = await scanMockups(paths.designMockups);
        res.json(entries);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // 디자인 시스템 문서 API (tokens.css / components.css / design-system.md 내용)
    this.app.get('/api/design/system/:file', async (req, res) => {
      const allowed = ['tokens.css', 'components.css', 'design-system.md'];
      if (!allowed.includes(req.params.file)) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      try {
        const filePath = path.join(paths.design, 'system', req.params.file);
        const content = await readFile(filePath, 'utf-8');
        res.type('text/plain').send(content);
      } catch {
        res.status(404).json({ error: 'File not found' });
      }
    });

    // 정적 서빙 — docs/design 전체를 /design-assets 에 마운트
    this.app.use('/design-assets', express.static(paths.design));

    // Design Canvas 클라이언트 (/design)
    const designClient = path.join(import.meta.dirname, 'design', 'canvas.html');
    this.app.get('/design', (_req, res) => {
      res.sendFile(designClient);
    });

    // Static files (dashboard client)
    const clientDir = path.join(import.meta.dirname, 'client', 'dist');
    this.app.use(express.static(clientDir));
    this.app.get('{*path}', (_req, res) => {
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  }

  private async listMarkdownFiles(dir: string): Promise<Array<{ filename: string; modified: string }>> {
    try {
      const files = await readdir(dir, { withFileTypes: true });
      const mdFiles = files
        .filter(f => f.isFile() && (f.name.endsWith('.md') || f.name.endsWith('.markdown')))
        .map(f => f.name);
      const results: Array<{ filename: string; modified: string }> = [];
      for (const name of mdFiles) {
        const { stat } = await import('node:fs/promises');
        const s = await stat(path.join(dir, name));
        results.push({ filename: name, modified: s.mtime.toISOString() });
      }
      return results.sort((a, b) => b.modified.localeCompare(a.modified));
    } catch {
      return [];
    }
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws) => {
      ws.on('error', () => {});
    });
  }

  private broadcast(data: { type: string; data: unknown }): void {
    const message = JSON.stringify(data);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  private startFileWatcher(): void {
    const paths = getProjectPaths(this.projectRoot);
    this.watcher = watch([paths.kanban, paths.sprints], {
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on('change', async (filePath) => {
      try {
        if (filePath.includes('kanban')) {
          const board = await this.kanban.getBoard();
          this.broadcast({ type: 'kanban_updated', data: board });
        } else if (filePath.includes('sprints')) {
          const store = await this.sprintManager.getSprintStore();
          this.broadcast({ type: 'sprints_updated', data: store });
        }
      } catch {
        // 무시
      }
    });
  }

  async start(): Promise<void> {
    await this.agentRegistry.load();
    this.startFileWatcher();

    return new Promise((resolve) => {
      this.httpServer.listen(this.port, () => {
        logger.success(`대시보드: http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
    }
    this.wss.close();
    this.httpServer.close();
  }
}
