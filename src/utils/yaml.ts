import { parse, stringify } from 'yaml';
import { readFile, writeFile } from 'node:fs/promises';

export async function readYaml<T>(filePath: string): Promise<T> {
  const content = await readFile(filePath, 'utf-8');
  return parse(content) as T;
}

export async function writeYaml(filePath: string, data: unknown): Promise<void> {
  const content = stringify(data, { indent: 2 });
  await writeFile(filePath, content, 'utf-8');
}
