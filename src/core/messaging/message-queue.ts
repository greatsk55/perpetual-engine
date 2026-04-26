import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';

export type MessagePriority = 'urgent' | 'normal';

export interface Message {
  id: string;
  from: string;
  to: string;
  type: 'info' | 'request' | 'meeting_invite' | 'review_request' | 'directive' | 'consultation_request';
  content: string;
  read: boolean;
  created_at: string;
  /**
   * 처리 우선순위. 'urgent' 는 사용자(investor)가 직접 보낸 directive 처럼
   * 진행 중인 워크플로우를 인터럽트해서라도 우선 처리해야 하는 메시지.
   * 미지정 시 'normal' 로 취급한다 (기존 호환).
   */
  priority?: MessagePriority;
}

export class MessageQueue {
  private messagesDir: string;

  constructor(messagesDir: string) {
    this.messagesDir = messagesDir;
  }

  async send(params: {
    from: string;
    to: string;
    type: Message['type'];
    content: string;
    priority?: MessagePriority;
  }): Promise<Message> {
    await mkdir(this.messagesDir, { recursive: true });

    const message: Message = {
      id: nanoid(),
      from: params.from,
      to: params.to,
      type: params.type,
      content: params.content,
      read: false,
      created_at: new Date().toISOString(),
      priority: params.priority ?? 'normal',
    };

    const filename = `${params.from}-${Date.now()}.json`;
    await writeFile(
      path.join(this.messagesDir, filename),
      JSON.stringify(message, null, 2),
      'utf-8',
    );

    return message;
  }

  async getUnread(recipient: string): Promise<Message[]> {
    const messages = await this.getAll();
    return messages.filter(m => !m.read && (m.to === recipient || m.to === 'all'));
  }

  async getAll(): Promise<Message[]> {
    if (!existsSync(this.messagesDir)) return [];

    const files = await readdir(this.messagesDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    const messages: Message[] = [];

    for (const file of jsonFiles) {
      try {
        const content = await readFile(path.join(this.messagesDir, file), 'utf-8');
        messages.push(JSON.parse(content));
      } catch {
        // 파싱 실패한 파일 무시
      }
    }

    // 우선순위(urgent 먼저) → created_at 오름차순. priority 미지정은 normal 로 취급.
    const rank = (p?: MessagePriority): number => (p === 'urgent' ? 0 : 1);
    return messages.sort((a, b) => {
      const r = rank(a.priority) - rank(b.priority);
      if (r !== 0) return r;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  }

  async markAsRead(messageId: string): Promise<void> {
    const files = await readdir(this.messagesDir);
    for (const file of files.filter(f => f.endsWith('.json'))) {
      const filePath = path.join(this.messagesDir, file);
      try {
        const content = await readFile(filePath, 'utf-8');
        const msg: Message = JSON.parse(content);
        if (msg.id === messageId) {
          msg.read = true;
          await writeFile(filePath, JSON.stringify(msg, null, 2), 'utf-8');
          return;
        }
      } catch {
        // 무시
      }
    }
  }
}
