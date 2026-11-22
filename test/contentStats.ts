import { readdirSync, readFileSync } from 'node:fs';

/** Counts derived from the repo's content/ files, so tests keep passing as weekly content is added. */
const QUIZ_DIR = new URL('../content/quizzes', import.meta.url).pathname;

type Item = { status: string };
type QuizFile = Item & { slug: string; kind?: string; title: { en: string }; questions: Item[]; badges?: Item[]; titles?: Item[] };

const files: QuizFile[] = readdirSync(QUIZ_DIR)
  .filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(readFileSync(`${QUIZ_DIR}/${name}`, 'utf8')) as QuizFile);
const published = <T extends Item>(items: T[] = []) => items.filter((item) => item.status === 'published');
const playable = published(files).filter((file) => file.kind === 'quiz');

export const repoContent = {
  quizzes: published(files).length,
  questions: published(files).reduce((sum, file) => sum + published(file.questions).length, 0),
  awards: published(files).reduce((sum, file) => sum + published(file.badges).length + published(file.titles).length, 0),
  playableSlugs: playable.map((file) => file.slug),
  playableTitles: playable.map((file) => file.title.en),
};
