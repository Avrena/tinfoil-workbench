import type { ToolCall } from './types.js';
import { InputError } from './validation.js';
export const PYTHON_TOOL = {
  type: 'function', function: {
    name: 'python', description: 'Execute Python on the user\'s computer after explicit approval. Print results. No packages are installed automatically. Write generated PNG, SVG, HTML, PDF, CSV, JSON, Markdown or text files into the artifacts directory in the working directory. Each call uses a fresh working directory; variables and files do not persist between calls. Native Python is not an OS security sandbox.',
    parameters: { type: 'object', properties: { code: { type: 'string', description: 'Python source code to execute.' } }, required: ['code'], additionalProperties: false },
  },
};
export function pythonArguments(value: string): { code: string } {
  if (value.length > 128000) throw new InputError('Python arguments exceed the size limit.');
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new InputError('The model supplied invalid Python arguments.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new InputError('Expected Python code arguments.');
  const v = parsed as Record<string, unknown>;
  if (Object.keys(v).some(k => k !== 'code') || typeof v.code !== 'string' || !v.code.trim() || v.code.length > 64000 || v.code.includes('\0'))
    throw new InputError('Python needs nonempty code of at most 64,000 characters.');
  return { code: v.code };
}
export class ToolCallAccumulator {
  private calls = new Map<number, ToolCall>();
  add(deltas: unknown): void {
    if (deltas === undefined) return;
    if (!Array.isArray(deltas) || deltas.length > 4) throw new InputError('Too many tool calls in one response.');
    for (const item of deltas) {
      if (!item || typeof item !== 'object') throw new InputError('Invalid streamed tool call.');
      const d = item as Record<string, any>;
      if (!Number.isInteger(d.index) || d.index < 0 || d.index >= 4 || (d.type && d.type !== 'function')) throw new InputError('Unsupported streamed tool call.');
      const call = this.calls.get(d.index) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
      if (d.id !== undefined) {
        if (typeof d.id !== 'string' || (call.id && call.id !== d.id)) throw new InputError('Tool identifier changed mid-stream.');
        call.id = d.id;
      }
      if (d.function) {
        if (typeof d.function !== 'object') throw new InputError('Invalid tool function.');
        for (const key of ['name','arguments'] as const) if (d.function[key] !== undefined) {
          if (typeof d.function[key] !== 'string') throw new InputError('Invalid tool function data.');
          call.function[key] += d.function[key];
        }
      }
      if (call.id.length > 200 || call.function.name.length > 80 || call.function.arguments.length > 128000) throw new InputError('Tool call exceeds the size limit.');
      this.calls.set(d.index, call);
    }
  }
  finish(): ToolCall[] {
    const calls = [...this.calls.entries()].sort(([a],[b]) => a-b).map(([,v]) => v);
    if (calls.some(c => !/^[\w-]{1,200}$/.test(c.id) || !c.function.name) || new Set(calls.map(c=>c.id)).size !== calls.length)
      throw new InputError('Missing or duplicate tool-call identifiers.');
    return calls;
  }
}
