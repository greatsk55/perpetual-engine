import { z } from 'zod';
import { readYaml, writeYaml } from '../../utils/yaml.js';

export const mcpServerSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
});

export const projectConfigSchema = z.object({
  localization: z.object({
    language: z.string().default('ko'),
    language_name: z.string().default('한국어 (Korean)'),
  }).default({}),
  company: z.object({
    name: z.string().default('My Startup'),
    mission: z.string().default(''),
  }).default({}),
  product: z.object({
    name: z.string().default('My Product'),
    description: z.string().default(''),
    target_users: z.string().default(''),
    core_value: z.string().default(''),
  }).default({}),
  constraints: z.object({
    tech_stack_preference: z.string().default('auto'),
    deploy_target: z.string().default('vercel'),
  }).default({}),
  agents: z.array(z.string()).default(['ceo', 'cto', 'po', 'designer', 'qa', 'marketer']),
  mcp_servers: z.record(mcpServerSchema).default({}),
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

export async function loadConfig(configPath: string): Promise<ProjectConfig> {
  const raw = await readYaml<unknown>(configPath);
  return projectConfigSchema.parse(raw);
}

export async function saveConfig(configPath: string, config: ProjectConfig): Promise<void> {
  await writeYaml(configPath, config);
}

export function createDefaultConfig(): ProjectConfig {
  return projectConfigSchema.parse({});
}
