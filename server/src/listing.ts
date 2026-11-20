// Drafts the texts of an app's App Store page from its source code: one structured request to Claude.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import { MAX_POLICY_CHARS, STORE_CATEGORIES, STORE_LIMITS, fitWords, type ErrorCode, type StoreListing } from '../../shared/protocol';
import { anthropic, hasCredentials } from './agent';
import { config } from './config';

/** Above this, the remaining files are named but not shown. Generated apps are far smaller. */
const SOURCE_CHAR_BUDGET = 200_000;

const Draft = z.object({
  name: z.string(),
  subtitle: z.string(),
  promo: z.string(),
  description: z.string(),
  keywords: z.string(),
  category: z.enum(STORE_CATEGORIES),
  ageRatingNotes: z.array(z.string()),
  privacyPolicy: z.string(),
});

const SYSTEM = `You write the App Store page for an iPhone app, working from the app's source code. The person who made the app is not a marketer and will publish what you write after reading it through, so it has to be true and ready to use.

Write in the language the app's own interface is written in (the text people see on screen), not the language of the code or of these instructions.

What each field is, with Apple's limits in characters:
- name: the app's name on the App Store, at most ${STORE_LIMITS.name}. Start from the name the app already has. A short descriptive tail ("Vanor: dagliga rutiner") is fine if it fits.
- subtitle: one line under the name saying what the app is for, at most ${STORE_LIMITS.subtitle}.
- promo: one or two sentences shown above the description, at most ${STORE_LIMITS.promo}.
- description: what the app does and who it is for, at most ${STORE_LIMITS.description} but usually 600 to 1200. Open with the most important thing in plain words, then the features as short paragraphs or lines starting with a dash. Plain text: no Markdown, no emoji.
- keywords: search words separated by commas with no spaces after the commas, at most ${STORE_LIMITS.keywords} in total. Words people would type to find this app. Leave out the words already in the name and the word "app".
- category: the one that fits best.
- ageRatingNotes: Apple rates every app by age. List what in this app would raise the rating, one short sentence each, in the same language as the rest: violence, weapons, sexual or suggestive content, crude language, alcohol, tobacco or drugs, gambling or loot boxes, horror, medical advice, contests, an open web browser, content or messages from other users, social features, shared location, dating, or advertising. Only what the code actually contains. An empty list when there is none of it, which is the usual case.
- privacyPolicy: a privacy policy for the app, in the same language, as plain text with a blank line between paragraphs and no headings, Markdown or lists. Say in plain words what information the app handles, where it is kept (only on the phone, or sent somewhere: say where, if the code sends it), which permissions it asks for and why (notifications, camera, location and so on), whether anything is shared with others, and how a person removes their information (deleting the app removes what is stored on the phone). State only what the code shows; do not promise anything the code does not do, and do not invent a company, an address or contact details: the page it is shown on adds who is responsible and how to reach them. Usually 120 to 300 words.

Describe only what the code actually does. Do not mention prices, other platforms, awards, rankings or other apps, and do not promise features, syncing or accounts that are not in the code: Apple rejects pages that do, and the person would be making claims they cannot back.`;

export type DraftResult =
  | {
      ok: true;
      draft: Pick<StoreListing, 'name' | 'subtitle' | 'promo' | 'description' | 'keywords' | 'category'>;
      ageRatingNotes: string[];
      privacyPolicy: string;
    }
  | { ok: false; error: ErrorCode };

function sourceText(files: Record<string, string>): string {
  const shown: string[] = [];
  const left: string[] = [];
  let used = 0;
  for (const [path, content] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (used + content.length > SOURCE_CHAR_BUDGET) {
      left.push(path);
      continue;
    }
    used += content.length;
    shown.push(`<file path="${path}">\n${content}\n</file>`);
  }
  const note = left.length ? `\n\nThese files are part of the app but too large to show here: ${left.join(', ')}.` : '';
  return shown.join('\n\n') + note;
}

/** Keeps whole keywords up to Apple's limit, in case the model overshoots. */
function fitKeywords(keywords: string): string {
  const words = keywords
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);
  let out = '';
  for (const word of words) {
    const next = out ? `${out},${word}` : word;
    if ([...next].length > STORE_LIMITS.keywords) break;
    out = next;
  }
  return out;
}

const LIMITED = ['name', 'subtitle', 'promo', 'description'] as const;
type Limited = (typeof LIMITED)[number];
type Texts = Record<Limited, string>;

const Shortened = z.object({ name: z.string(), subtitle: z.string(), promo: z.string(), description: z.string() });

/** Apple counts characters the way people do, not UTF-16 units. */
const length = (s: string) => [...s].length;
const tooLong = (texts: Texts) => LIMITED.filter((key) => length(texts[key]) > STORE_LIMITS[key]);

/**
 * Models count characters poorly, and a subtitle one character over Apple's limit cannot be sent.
 * Fields that came out too long are sent back once with their exact counts to be shortened; whatever
 * is still too long after that is cut at a word.
 */
export async function withinLimits(texts: Texts): Promise<Texts> {
  let out = { ...texts };
  const over = tooLong(out);
  if (over.length > 0) {
    const lines = over.map((key) => `- ${key}: ${length(out[key])} characters now, at most ${STORE_LIMITS[key] - 2} allowed:\n${out[key]}`);
    try {
      const message = await anthropic().beta.messages.parse({
        model: config.model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low', format: betaZodOutputFormat(Shortened) },
        system:
          'You shorten texts for an App Store page so they fit a character limit. Keep the language, the meaning and the tone; drop the least important words rather than abbreviating. Count the characters, spaces included. Give back every field: the shortened text for the ones listed, and an empty string for the others.',
        messages: [{ role: 'user', content: `These are too long:\n\n${lines.join('\n\n')}` }],
      });
      const shorter = message.parsed_output;
      if (shorter) for (const key of over) if (shorter[key].trim()) out = { ...out, [key]: shorter[key].trim() };
    } catch (err) {
      console.warn('[listing] could not shorten the draft:', (err as Error).message);
    }
  }
  for (const key of tooLong(out)) out = { ...out, [key]: fitWords(out[key], STORE_LIMITS[key]) };
  return out;
}

export async function draftListing(appName: string, files: Record<string, string>): Promise<DraftResult> {
  if (!hasCredentials()) return { ok: false, error: 'no_api_key' };
  try {
    const message = await anthropic().beta.messages.parse({
      model: config.model,
      max_tokens: 16000,
      // If the model declines for policy reasons, the API retries on its default fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: betaZodOutputFormat(Draft) },
      system: SYSTEM,
      messages: [{ role: 'user', content: `The app is called "${appName}". Its source code:\n\n${sourceText(files)}` }],
    });
    if (message.stop_reason === 'refusal') return { ok: false, error: 'refused' };
    if (message.stop_reason === 'max_tokens') return { ok: false, error: 'too_long' };
    const draft = message.parsed_output;
    if (!draft) return { ok: false, error: 'internal' };
    const { ageRatingNotes, privacyPolicy, ...texts } = draft;
    const fitted = await withinLimits(texts);
    return {
      ok: true,
      draft: { ...texts, ...fitted, keywords: fitKeywords(texts.keywords) },
      ageRatingNotes: ageRatingNotes.slice(0, 12),
      privacyPolicy: privacyPolicy.trim().slice(0, MAX_POLICY_CHARS),
    };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, error: 'no_api_key' };
    if (err instanceof Anthropic.RateLimitError) return { ok: false, error: 'rate_limited' };
    if (err instanceof Anthropic.APIError && typeof err.status === 'number' && err.status >= 500) return { ok: false, error: 'overloaded' };
    console.error('[listing] draft failed:', err);
    return { ok: false, error: 'internal' };
  }
}
