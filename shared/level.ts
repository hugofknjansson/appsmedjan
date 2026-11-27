// How much of what is under the hood a person is shown.
//
// Everyone starts at the first level, where nothing is said about how an app is made. The service
// reads what the person writes to the builder and what they do, and shows more once it is plain that
// they would rather see it: first what the builder does and Apple's own words, then the code and the
// ids. It only ever moves up by itself; the person can choose a level themself, and that choice stands.

/** 1: only what is needed. 2: what the builder does, and Apple's own words. 3: the code and everything else. */
export type Level = 1 | 2 | 3;

export const isLevel = (value: unknown): value is Level => value === 1 || value === 2 || value === 3;

/**
 * Things a person does that say something about how used they are to this.
 *
 * apple: connected a developer account of their own. upload: sent an app to TestFlight. store: sent
 * an App Store page to Apple. details: opened what Apple answered. classic: chose to fill in the
 * Apple account's every field at once over being led through it.
 */
export type LevelAct = 'apple' | 'upload' | 'store' | 'details' | 'classic';

export const LEVEL_ACTS: LevelAct[] = ['apple', 'upload', 'store', 'details', 'classic'];

/** The acts a client reports: the others are seen by the server as they happen. */
export const isReportedAct = (value: unknown): value is LevelAct => value === 'details' || value === 'classic';

/** What has been noticed about a person: which words they have used (by key, never their text) and what they have done. */
export interface LevelSigns {
  words: string[];
  acts: LevelAct[];
}

export const NO_SIGNS: LevelSigns = { words: [], acts: [] };

/** What the clients are told. */
export interface LevelState {
  /** The level shown now. */
  level: Level;
  /** The person's own choice, or null while the level follows what they write and do. */
  chosen: Level | null;
  /** True when the level has gone up by itself and the person has not been told yet. */
  fresh: boolean;
  /** True when the person has asked about Google Play or Android, which there is an honest answer to. */
  play: boolean;
}

export const FIRST_LEVEL: LevelState = { level: 1, chosen: null, fresh: false, play: false };

/**
 * familiar: words of someone who has been near app making. developer: words of someone who writes
 * code. store: words about getting an app out to people.
 */
type WordKind = 'familiar' | 'developer' | 'store';

/**
 * The words listened for, in Swedish and English: a key, its kind, and what it looks like in lower
 * case. Words that mean something else to most people are left out or narrowed (an IPA is a beer,
 * Swift a singer, a server someone who waits tables, and to compile is to make a list).
 */
const WORDS: Array<[key: string, kind: WordKind, pattern: string]> = [
  ['appstore', 'store', 'app ?store|appstore'],
  ['play', 'store', 'play ?store|google ?play|play[- ]butiken'],
  ['testflight', 'store', 'testflight'],

  ['android', 'familiar', 'android'],
  ['api', 'familiar', 'api(et|:et|er|:er|s)?'],
  ['backend', 'familiar', 'backend\\w*|frontend\\w*'],
  ['database', 'familiar', 'databas\\w*|database\\w*'],
  ['json', 'familiar', 'json'],
  ['beta', 'familiar', 'beta ?test\\w*|beta ?version\\w*'],
  ['bundleid', 'familiar', 'bundle[- ]?id\\w*'],
  ['asc', 'familiar', 'app store connect'],
  ['push', 'familiar', 'push[- ]?notis\\w*|push notifications?'],
  ['simulator', 'familiar', 'simulatorn|ios[- ]simulator\\w*|the simulator'],
  ['prototype', 'familiar', 'prototyp\\w*|wireframe\\w*'],
  ['ui', 'familiar', 'ui|ux|gui'],
  ['widget', 'familiar', 'widget\\w*'],
  ['deeplink', 'familiar', 'deep ?link\\w*|djuplänk\\w*'],
  ['cache', 'familiar', 'cach\\w+'],
  ['buildnumber', 'familiar', 'buildnummer|byggnummer|build number|versionsnummer'],
  ['abtest', 'familiar', 'a/b[- ]?test\\w*|analytics'],

  ['swift', 'developer', '(?<!taylor )swift ?\\d*|swiftui|swiftdata|uikit|objective-?c'],
  ['xcode', 'developer', 'xcode\\w*'],
  ['otherstack', 'developer', 'kotlin|flutter|react native|jetpack compose|android studio|gradle'],
  ['git', 'developer', 'git|github|gitlab|repo(t|n|s|sitory)?|pull request\\w*|merge request\\w*'],
  ['ci', 'developer', 'ci/cd|github actions|fastlane'],
  ['signing', 'developer', 'provisioning\\w*|provisioneringsprofil\\w*|signing certificate\\w*|signeringscertifikat\\w*|distributionscertifikat\\w*|entitlement\\w*'],
  ['package', 'developer', '\\.ipa|ipa-fil\\w*|ipa file\\w*|apk|aab|sdk\\w*|info\\.plist|plist'],
  ['compile', 'developer', 'kompilera\\w*|kompilator\\w*|compiler\\w*|compile errors?|compilation|kompileringsfel\\w*'],
  ['refactor', 'developer', 'refactor\\w*|refaktor\\w*'],
  ['pattern', 'developer', 'mvvm|mvc|viewmodel\\w*|view model\\w*|@state|@observable|@binding|@published|core ?data'],
  ['source', 'developer', 'källkod\\w*|source code'],
  ['web', 'developer', 'endpoint\\w*|rest[- ]?api\\w*|graphql|webhook\\w*'],
  ['deps', 'developer', 'cocoapods|swift packages?|spm|npm'],
  ['tests', 'developer', 'unit ?tests?|enhetstest\\w*|xctest\\w*|debug\\w*|stack ?trace\\w*|breakpoint\\w*'],
  ['languages', 'developer', 'typescript|javascript|python|async/await|firebase|supabase'],
  // Said of oneself; "I am no developer" says the opposite.
  ['self', 'developer', '(?<!(?:inte|ingen|ej|not|no|not a|not an|aldrig|never) (?:en |a )?)(?:utvecklare|apputvecklare|developer|programmerare|programmer|kodare)'],
];

const KIND = new Map(WORDS.map(([key, kind]) => [key, kind]));
const MATCHERS = WORDS.map(([key, , pattern]) => ({ key, re: new RegExp(`(?<![\\p{L}\\p{N}@.])(?:${pattern})(?![\\p{L}\\p{N}])`, 'iu') }));

/** The keys of the words listened for that are in the text. */
export function wordsIn(text: string): string[] {
  const lower = text.toLowerCase().replace(/\s+/g, ' ');
  return MATCHERS.filter(({ re }) => re.test(lower)).map(({ key }) => key);
}

/** The signs with what the text adds, or the same object when it adds nothing. */
export function withWords(signs: LevelSigns, text: string): LevelSigns {
  const added = wordsIn(text).filter((key) => !signs.words.includes(key));
  return added.length === 0 ? signs : { ...signs, words: [...signs.words, ...added] };
}

/** The signs with the act, or the same object when it was there already. */
export function withAct(signs: LevelSigns, act: LevelAct): LevelSigns {
  return signs.acts.includes(act) ? signs : { ...signs, acts: [...signs.acts, act] };
}

const WORD_POINTS: Record<WordKind, number> = { familiar: 1, store: 1, developer: 3 };
const ACT_POINTS: Record<LevelAct, number> = { apple: 2, upload: 1, store: 2, details: 1, classic: 2 };

/** What the signs add up to. Each word and each act counts once, however often it comes back. */
export function levelPoints(signs: LevelSigns): number {
  const words = signs.words.reduce((sum, key) => sum + WORD_POINTS[KIND.get(key) ?? 'familiar'], 0);
  const acts = signs.acts.reduce((sum, act) => sum + (ACT_POINTS[act] ?? 0), 0);
  return words + acts;
}

/**
 * The level the signs point to.
 *
 * 2: three points. One developer's word is enough, or three words of someone who has been near app
 * making, or an Apple developer account of their own and one such word.
 *
 * 3: a developer who wants the app out: a developer's word, a sign of wanting to release (a word
 * about the stores, an account of their own, an upload) and five points. Or three developer's words,
 * which nobody else uses.
 */
export function levelFor(signs: LevelSigns): Level {
  const kinds = signs.words.map((key) => KIND.get(key));
  const developer = kinds.filter((kind) => kind === 'developer').length;
  const releasing = kinds.includes('store') || signs.acts.some((act) => act === 'apple' || act === 'upload' || act === 'store');
  const points = levelPoints(signs);
  if (developer >= 3 || (developer >= 1 && releasing && points >= 5)) return 3;
  return points >= 3 ? 2 : 1;
}

/** `told`: the level the person was last told about (or chose to leave). */
export function levelState(signs: LevelSigns, chosen: Level | null, told: Level): LevelState {
  const found = levelFor(signs);
  return {
    level: chosen ?? found,
    chosen,
    fresh: chosen === null && found > told,
    play: signs.words.includes('play') || signs.words.includes('android'),
  };
}

/**
 * What the builder is told about a person who is shown more than the first level, since everything
 * it has been told otherwise is that the person never sees code. Null at the first level.
 */
export function builderNote(level: Level): string | null {
  if (level === 1) return null;
  if (level === 2) {
    return 'About this person: they have some experience of app making. They can see a list of the steps you take (a part written, the app tried). Words like "screen", "data", "API" and "TestFlight" are fine with them. Still keep replies short and in plain text, and still leave out file names, Swift and build output.';
  }
  return 'About this person: they are a developer. They can read every source file of the project in a Code tab and download it as an Xcode project, and they see the steps you take with file names. With them, the rule about never mentioning code does not apply: name files, types and frameworks where it helps, say in a sentence which technical choice you made and why, and answer technical questions directly. Still keep replies short and in plain text, and still call `say` in plain words. If they ask about Android or Google Play: this project is native SwiftUI and builds for iPhone only; say so in a sentence.';
}
