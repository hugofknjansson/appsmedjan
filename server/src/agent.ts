// The app-building agent: a streaming tool loop on the Claude Messages API.
// Every tool acts on this server's own state (project files in the database, the Mac build worker).
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  MAX_FILE_BYTES,
  MAX_FILES,
  isValidSourcePath,
  type ChatMessage,
  type ErrorCode,
  type Step,
  type StepKind,
  type TokenUse,
} from '../../shared/protocol';
import { config } from './config';
import * as db from './db';
import { IconError, drawIcon } from './icon';
import { addPart, appendText, send, upsertStep } from './live';
import { chargeWork } from './plans';
import { buildProject } from './preview';
import { SYSTEM_PROMPT } from './prompt';
import * as workers from './workers';

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;
type ToolResultContent = Exclude<ToolResult['content'], string | undefined>;

const MAX_TURNS = 60;
const MAX_BUILDS = 12;
/** Above this, files are listed by name only and the agent reads the ones it needs. */
const SNAPSHOT_CHAR_BUDGET = 300_000;
/** How many earlier chat messages are replayed to the model as context. */
const HISTORY_MESSAGES = 30;

let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export function hasCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

// --- Tools -------------------------------------------------------------------

const pathField = {
  type: 'string',
  description: 'Path under Sources/, for example "Sources/Views/HomeView.swift".',
} as const;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'write_file',
    description:
      'Create a file or replace its entire content. Use this for new files and for large rewrites; use edit_file for small changes to an existing file.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { path: pathField, content: { type: 'string', description: 'The complete file content.' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Replace one exact piece of text in an existing file. old_string must occur exactly once in the file, so include enough surrounding lines to make it unique.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        path: pathField,
        old_string: { type: 'string', description: 'The exact text to replace, including whitespace.' },
        new_string: { type: 'string', description: 'The text to put in its place.' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the current content of a project file.',
    eager_input_streaming: true,
    input_schema: { type: 'object', properties: { path: pathField }, required: ['path'] },
  },
  {
    name: 'delete_file',
    description: 'Delete a project file.',
    eager_input_streaming: true,
    input_schema: { type: 'object', properties: { path: pathField }, required: ['path'] },
  },
  {
    name: 'build_and_run',
    description:
      "Compile the app and launch it in the person's simulator. Returns either success or the compiler errors. Call this after every set of changes.",
    eager_input_streaming: true,
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'view_screen',
    description: 'Take a screenshot of the app as it currently appears in the simulator.',
    eager_input_streaming: true,
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'rename_app',
    description: "Set the app's name as shown under its icon and in the project list. Keep it short.",
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'One to three words, at most 30 characters.' } },
      required: ['name'],
    },
  },
  {
    name: 'say',
    description:
      'Tell the person, in a few plain words, what you are making right now. It is shown large on their screen while they wait. Call it together with the tool calls it describes.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'At most eight words, in the language the person writes in. Nothing technical.' } },
      required: ['text'],
    },
  },
  {
    name: 'set_app_icon',
    description:
      "Set the app's icon, the picture on the person's home screen, from an SVG you draw. One <svg viewBox=\"0 0 1024 1024\"> with a background that fills the whole square and one bold, simple motif. Plain shapes and gradients only: no text, no images, no scripts.",
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { svg: { type: 'string', description: 'The complete <svg> element, at most 20 000 characters.' } },
      required: ['svg'],
    },
  },
];

const Inputs = {
  write_file: z.object({ path: z.string(), content: z.string() }),
  edit_file: z.object({ path: z.string(), old_string: z.string().min(1), new_string: z.string() }),
  read_file: z.object({ path: z.string() }),
  delete_file: z.object({ path: z.string() }),
  build_and_run: z.object({}),
  view_screen: z.object({}),
  rename_app: z.object({ name: z.string().min(1) }),
  set_app_icon: z.object({ svg: z.string().min(1) }),
  say: z.object({ text: z.string().min(1) }),
};
type ToolName = keyof typeof Inputs;

const STEP_KIND: Record<ToolName, StepKind> = {
  write_file: 'write',
  edit_file: 'edit',
  read_file: 'read',
  delete_file: 'delete',
  build_and_run: 'build',
  view_screen: 'look',
  rename_app: 'rename',
  set_app_icon: 'icon',
  say: 'say',
};

const isToolName = (name: string): name is ToolName => name in Inputs;

class ToolError extends Error {}

const BAD_PATH =
  'Invalid path. Files must be under Sources/, use letters, digits, spaces, "-", "_" or "+" in names, and end in .swift, .json, .txt, .strings or .xcstrings.';

interface RunState {
  projectId: string;
  builds: number;
}

type Outcome = { content: string | ToolResultContent; detail?: string };

/** What the builder says is shown large on a phone: one line, and not a long one. */
function said(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 80);
}

async function executeTool(name: ToolName, rawInput: unknown, run: RunState): Promise<Outcome> {
  const { projectId } = run;
  switch (name) {
    case 'write_file': {
      const { path, content } = Inputs.write_file.parse(rawInput);
      if (!isValidSourcePath(path)) throw new ToolError(BAD_PATH);
      if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new ToolError('File too large; split it into smaller files.');
      if (db.getFile(projectId, path) === null && db.countFiles(projectId) >= MAX_FILES) {
        throw new ToolError(`The project already has ${MAX_FILES} files, which is the limit.`);
      }
      db.putFile(projectId, path, content);
      send(projectId, { type: 'files.changed' });
      return { content: `Wrote ${path}.`, detail: path };
    }
    case 'edit_file': {
      const { path, old_string, new_string } = Inputs.edit_file.parse(rawInput);
      if (!isValidSourcePath(path)) throw new ToolError(BAD_PATH);
      const current = db.getFile(projectId, path);
      if (current === null) throw new ToolError(`${path} does not exist.`);
      const count = current.split(old_string).length - 1;
      if (count === 0) throw new ToolError('old_string was not found in the file. Read the file and try again.');
      if (count > 1) throw new ToolError(`old_string occurs ${count} times; include more context so it is unique.`);
      const updated = current.replace(old_string, () => new_string);
      if (Buffer.byteLength(updated) > MAX_FILE_BYTES) throw new ToolError('File too large; split it into smaller files.');
      db.putFile(projectId, path, updated);
      send(projectId, { type: 'files.changed' });
      return { content: `Edited ${path}.`, detail: path };
    }
    case 'read_file': {
      const { path } = Inputs.read_file.parse(rawInput);
      const content = isValidSourcePath(path) ? db.getFile(projectId, path) : null;
      if (content === null) throw new ToolError(`${path} does not exist.`);
      return { content, detail: path };
    }
    case 'delete_file': {
      const { path } = Inputs.delete_file.parse(rawInput);
      if (!isValidSourcePath(path) || !db.deleteFile(projectId, path)) throw new ToolError(`${path} does not exist.`);
      send(projectId, { type: 'files.changed' });
      return { content: `Deleted ${path}.`, detail: path };
    }
    case 'build_and_run': {
      if (run.builds >= MAX_BUILDS) {
        throw new ToolError(
          'Build limit for this turn reached. Stop here and tell the person plainly what works and what does not.',
        );
      }
      run.builds += 1;
      const outcome = await buildProject(projectId);
      if (outcome.kind === 'ok') return { content: 'Build succeeded. The app is running in the simulator.' };
      if (outcome.kind === 'unavailable') {
        return {
          content:
            'The build service is offline right now, so the code could not be compiled or shown. Do not retry. Finish the changes carefully, then tell the person the app is written but the preview is unavailable at the moment.',
        };
      }
      throw new ToolError(`Build failed:\n${outcome.errors}`);
    }
    case 'view_screen': {
      const shot = workers.hasSimulator(projectId) ? await workers.screenshot(projectId) : null;
      if (!shot) return { content: 'No screenshot is available right now.' };
      const media = shot.mime === 'image/png' ? 'image/png' : 'image/jpeg';
      return { content: [{ type: 'image', source: { type: 'base64', media_type: media, data: shot.data } }] };
    }
    case 'say': {
      const text = said(Inputs.say.parse(rawInput).text);
      if (!text) throw new ToolError('Say something.');
      return { content: 'Shown.', detail: text };
    }
    case 'set_app_icon': {
      const { svg } = Inputs.set_app_icon.parse(rawInput);
      try {
        if (drawIcon(projectId, svg) === 'kept_own') {
          return { content: 'The person has chosen an icon of their own for this app, so it was kept. Do not try again.' };
        }
      } catch (err) {
        if (err instanceof IconError) throw new ToolError(`The icon was not saved. ${err.message}`);
        throw err;
      }
      return { content: 'The icon is saved.' };
    }
    case 'rename_app': {
      const name = Inputs.rename_app.parse(rawInput).name.replace(/\s+/g, ' ').trim().slice(0, 30);
      if (!name) throw new ToolError('The name is empty.');
      db.renameProject(projectId, name);
      send(projectId, { type: 'project', name });
      return { content: `The app is now called "${name}".`, detail: name };
    }
  }
}

// --- Conversation ------------------------------------------------------------

function snapshot(projectId: string): string {
  const files = db.getFiles(projectId);
  const entries = Object.entries(files);
  const total = entries.reduce((n, [, c]) => n + c.length, 0);
  if (total <= SNAPSHOT_CHAR_BUDGET) {
    const body = entries.map(([p, c]) => `<file path="${p}">\n${c}\n</file>`).join('\n');
    return `<project_files>\n${body}\n</project_files>`;
  }
  const list = entries.map(([p, c]) => `${p} (${c.length} characters)`).join('\n');
  return `<project_files note="The project is too large to include in full. Use read_file for the files you need.">\n${list}\n</project_files>`;
}

function assistantText(m: ChatMessage): string {
  const text = m.parts
    .filter((p) => p.t === 'text')
    .map((p) => (p.t === 'text' ? p.text : ''))
    .join('\n\n')
    .trim();
  return text || '(I made changes to the app.)';
}

function buildMessages(projectId: string, history: ChatMessage[], userText: string): MessageParam[] {
  const messages: MessageParam[] = history.slice(-HISTORY_MESSAGES).map((m) => ({
    role: m.role,
    content: m.role === 'user' ? m.text : assistantText(m),
  }));
  messages.push({
    role: 'user',
    content: [
      { type: 'text', text: `Current state of the project:\n${snapshot(projectId)}` },
      { type: 'text', text: userText },
    ],
  });
  return messages;
}

export class RunError extends Error {
  constructor(public code: ErrorCode) {
    super(code);
  }
}

function toRunError(err: unknown, signal: AbortSignal): RunError {
  if (err instanceof RunError) return err;
  if (signal.aborted || err instanceof Anthropic.APIUserAbortError) return new RunError('stopped');
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new RunError('no_api_key');
  }
  if (err instanceof Anthropic.RateLimitError) return new RunError('rate_limited');
  if (err instanceof Anthropic.APIError && typeof err.status === 'number' && err.status >= 500) {
    return new RunError('overloaded');
  }
  console.error('[agent] run failed:', err);
  return new RunError('internal');
}

/**
 * Runs one turn of the agent for a chat message. Progress is published through the live state;
 * the promise resolves when the agent is done and rejects with a RunError otherwise.
 */
export async function runAgent(
  projectId: string,
  history: ChatMessage[],
  userText: string,
  signal: AbortSignal,
): Promise<void> {
  const run: RunState = { projectId, builds: 0 };
  const messages = buildMessages(projectId, history, userText);
  let streamRetries = 0;
  // What this run cost in tokens, logged when it ends: the four kinds are billed at different rates.
  const used = { turns: 0, input: 0, cacheWritten: 0, cacheRead: 0, output: 0 };
  // Per turn, with the model that answered it: a fallback model is priced at its own rates.
  const uses: TokenUse[] = [];
  let outcome = 'done';
  // Whose work it is, read now: the project may be deleted while the builder works.
  const owner = db.getProject(projectId)?.userId ?? null;

  // Lets a long tool call (a build can take minutes) be abandoned the moment the person presses Stop.
  const stopped = new Promise<never>((_, reject) => {
    const onAbort = () => reject(new RunError('stopped'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  stopped.catch(() => undefined);

  try {
    if (!hasCredentials()) throw new RunError('no_api_key');
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const stream = anthropic().beta.messages.stream(
        {
          model: config.model,
          max_tokens: 64000,
          // If the model declines for policy reasons, the API retries on its default fallback model.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          thinking: { type: 'adaptive' },
          output_config: { effort: config.effort },
          cache_control: { type: 'ephemeral' },
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages,
        },
        { signal },
      );

      // Show a progress row as soon as a tool call starts streaming, and fill in the
      // file name once it appears in the partial input.
      const started = new Map<number, { step: Step; json: string }>();
      let textThisTurn = false;
      let message: Anthropic.Beta.BetaMessage;
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
            const { id, name } = event.content_block;
            if (!isToolName(name)) continue;
            const step: Step = { id, kind: STEP_KIND[name], detail: '', status: 'running' };
            started.set(event.index, { step, json: '' });
            upsertStep(projectId, step);
          } else if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
            const s = started.get(event.index);
            if (!s || s.step.detail) continue;
            s.json += event.delta.partial_json;
            // What the builder says is read when the whole of it is there (below), not from a half-written string.
            if (s.step.kind === 'say') continue;
            const m = /"(?:path|name)"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(s.json);
            if (m) {
              s.step = { ...s.step, detail: m[1]!.slice(0, 160) };
              upsertStep(projectId, s.step);
            }
          } else if (event.type === 'content_block_stop') {
            // Shown the moment it has been said, not when the tool calls after it have been written too.
            const s = started.get(event.index);
            if (s?.step.kind === 'say' && !s.step.detail) {
              try {
                const text = said(String((JSON.parse(s.json) as { text?: unknown }).text ?? ''));
                if (text) {
                  s.step = { ...s.step, detail: text };
                  upsertStep(projectId, s.step);
                }
              } catch {
                // Not complete after all; the tool call itself fills it in.
              }
            }
          } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            // Separate this turn's text from text written before earlier tool calls.
            if (!textThisTurn && turn > 0) appendText(projectId, '\n\n');
            textThisTurn = true;
            appendText(projectId, event.delta.text);
          }
        }
        message = await stream.finalMessage();
        streamRetries = 0;
        used.turns++;
        used.input += message.usage.input_tokens;
        used.cacheWritten += message.usage.cache_creation_input_tokens ?? 0;
        used.cacheRead += message.usage.cache_read_input_tokens ?? 0;
        used.output += message.usage.output_tokens;
        uses.push({
          model: message.model,
          input: message.usage.input_tokens,
          cacheWritten: message.usage.cache_creation_input_tokens ?? 0,
          cacheRead: message.usage.cache_read_input_tokens ?? 0,
          output: message.usage.output_tokens,
        });
      } catch (err) {
        // A tool input that could not be parsed, or a dropped connection: re-issue the turn.
        if (err instanceof Anthropic.APIError || signal.aborted || streamRetries++ >= 2) throw err;
        for (const s of started.values()) upsertStep(projectId, { ...s.step, status: 'error' });
        continue;
      }

      const toolUses = message.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
      );
      const failSteps = () => {
        for (const t of toolUses) {
          if (isToolName(t.name)) {
            upsertStep(projectId, { id: t.id, kind: STEP_KIND[t.name], detail: '', status: 'error' });
          }
        }
      };

      // A refusal can cut a tool call off mid-input, so its tools are never run.
      if (message.stop_reason === 'refusal') {
        failSteps();
        throw new RunError('refused');
      }
      if (message.stop_reason === 'max_tokens') {
        failSteps();
        throw new RunError('too_long');
      }
      if (message.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }
      if (toolUses.length === 0) return;

      messages.push({ role: 'assistant', content: message.content });

      const results: ToolResult[] = [];
      for (const tool of toolUses) {
        if (signal.aborted) throw new RunError('stopped');
        if (!isToolName(tool.name)) {
          results.push({ type: 'tool_result', tool_use_id: tool.id, is_error: true, content: 'Unknown tool.' });
          continue;
        }
        const kind = STEP_KIND[tool.name];
        const known = [...started.values()].find((s) => s.step.id === tool.id)?.step.detail ?? '';
        // With eager input streaming the input is not validated by the API, so check it here.
        const parsed = Inputs[tool.name].safeParse(tool.input);
        if (!parsed.success) {
          upsertStep(projectId, { id: tool.id, kind, detail: known, status: 'error' });
          results.push({
            type: 'tool_result',
            tool_use_id: tool.id,
            is_error: true,
            content: JSON.stringify({ INVALID_JSON: JSON.stringify(tool.input) }),
          });
          continue;
        }
        try {
          const work = executeTool(tool.name, parsed.data, run);
          work.catch(() => undefined); // If we stop waiting, a late failure must not go unhandled.
          const outcome = await Promise.race([work, stopped]);
          upsertStep(projectId, { id: tool.id, kind, detail: outcome.detail ?? known, status: 'done' });
          results.push({ type: 'tool_result', tool_use_id: tool.id, content: outcome.content });
        } catch (err) {
          if (!(err instanceof ToolError)) throw err;
          upsertStep(projectId, { id: tool.id, kind, detail: known, status: 'error' });
          results.push({ type: 'tool_result', tool_use_id: tool.id, is_error: true, content: err.message });
        }
      }
      messages.push({ role: 'user', content: results });
    }
    throw new RunError('too_long');
  } catch (err) {
    const runError = toRunError(err, signal);
    outcome = runError.code;
    addPart(projectId, { t: 'error', code: runError.code });
    throw runError;
  } finally {
    // A finished run, or one the person stopped, is charged. One the service failed to finish is only recorded.
    let cost = '';
    try {
      const spent = owner ? chargeWork(owner, { projectId, what: 'build', uses, charge: outcome === 'done' || outcome === 'stopped' }) : null;
      if (spent) cost = `, ${spent.dollars.toFixed(3)} dollars, ${spent.credits} credits, ${spent.charged} charged`;
    } catch (err) {
      console.error(`[credits] ${projectId}: the run's cost was not recorded:`, err);
    }
    console.log(
      `[usage] ${projectId} ${outcome}: ${used.turns} turns, ${run.builds} builds, ${config.model} ${config.effort}, ` +
        `input ${used.input}, cache written ${used.cacheWritten}, cache read ${used.cacheRead}, output ${used.output}${cost}`,
    );
  }
}
