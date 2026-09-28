import type { GenerationSettings, InstructionPreset, Workspace } from './types.js';
import { InputError, LIMITS, instructionName, text } from './validation.js';
import { uid } from './workspace.js';

/** Optional read-only starting points. None is ever applied unless the user selects it. */
export const STARTER_INSTRUCTIONS: readonly InstructionPreset[] = Object.freeze([
  { id: 'starter-concise', name: 'Concise', text: 'Be concise. Lead with the direct answer, then add only the detail needed to act on it. Prefer short paragraphs or lists, and skip preambles, repetition and closing summaries unless I ask for more.' },
  { id: 'starter-explainer', name: 'Explainer', text: 'Explain step by step for a curious reader who is new to the topic. Define terms the first time they appear, use a short worked example when it helps, and state assumptions and uncertainty plainly.' },
  { id: 'starter-editor', name: 'Editor', text: 'Act as a careful editor. Improve clarity, structure, grammar and flow while preserving my voice and meaning. Briefly explain significant changes, and do not add facts or claims that are not in my text.' },
  { id: 'starter-code', name: 'Code assistant', text: 'Act as an experienced software engineer. Give correct, idiomatic code with short explanations, point out edge cases, security issues and trade-offs, and ask about missing requirements instead of guessing.' },
].map(p => Object.freeze({ ...p, createdAt: 0, updatedAt: 0 })));

export type ActiveInstructions =
  | { kind: 'none' }
  | { kind: 'saved' | 'starter'; preset: InstructionPreset }
  | { kind: 'custom'; name: string; text: string };

/** The list entry a thread's instructions match exactly (name and text), if any. */
export function activeInstructions(settings: Pick<GenerationSettings, 'systemPrompt' | 'systemPromptName'>, saved: readonly InstructionPreset[]): ActiveInstructions {
  if (!settings.systemPrompt.trim()) return { kind: 'none' };
  const name = settings.systemPromptName ?? '';
  const same = (p: InstructionPreset): boolean => p.text === settings.systemPrompt && p.name === name;
  const own = saved.find(same);
  if (own) return { kind: 'saved', preset: own };
  const starter = STARTER_INSTRUCTIONS.find(same);
  if (starter) return { kind: 'starter', preset: starter };
  return { kind: 'custom', name, text: settings.systemPrompt };
}

function uniqueName(w: Workspace, value: unknown, except?: string): string {
  const name = instructionName(value, true), key = name.toLocaleLowerCase();
  if (w.instructionPresets.some(p => p.id !== except && p.name.toLocaleLowerCase() === key)) throw new InputError('Saved instructions with this name already exist.');
  return name;
}
/** Create (no id) or update a saved entry. Conversations keep the copy they already use. */
export function saveInstructionPreset(w: Workspace, id: string | undefined, name: unknown, body: unknown): InstructionPreset {
  const value = text(body, 'Saved instructions', LIMITS.instructions, true), now = Date.now();
  if (id === undefined) {
    if (w.instructionPresets.length >= LIMITS.instructionPresets) throw new InputError('Saved instructions limit reached. Delete an entry first.');
    const preset = { id: uid(), name: uniqueName(w, name), text: value, createdAt: now, updatedAt: now };
    w.instructionPresets.push(preset);
    return preset;
  }
  const preset = w.instructionPresets.find(p => p.id === id);
  if (!preset) throw new InputError('These saved instructions no longer exist.');
  preset.name = uniqueName(w, name, id); preset.text = value; preset.updatedAt = now;
  return preset;
}
/** Removing a saved entry never changes a conversation that already uses its text. */
export function deleteInstructionPreset(w: Workspace, id: string): void {
  if (!w.instructionPresets.some(p => p.id === id)) throw new InputError('These saved instructions no longer exist.');
  w.instructionPresets = w.instructionPresets.filter(p => p.id !== id);
}
/** A single-line preview for lists; the stored text is unchanged. */
export function instructionExcerpt(value: string, max = 150): string {
  // Bound the work for 40,000-character instructions; only the start is displayed.
  const head = value.slice(0, max * 4), line = head.replace(/\s+/g, ' ').trim(), points = [...line];
  if (points.length > max) return points.slice(0, max - 1).join('').trimEnd() + '…';
  return value.length > head.length && value.slice(head.length).trim() ? line + '…' : line;
}
