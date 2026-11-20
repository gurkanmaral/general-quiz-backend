import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { award, question, quiz, rotation, scheduleEntry } from '../src/db/schema';
import { countChanges, importContent } from '../src/modules/content';
import { openTestDatabase, truncateAll } from './db';

const database = openTestDatabase();
const db = database.db;
const REPO_CONTENT = new URL('../../../content', import.meta.url).pathname;
let dir: string;

async function editJson(path: string, edit: (value: any) => void) {
  const file = join(dir, path);
  const value = JSON.parse(await readFile(file, 'utf8'));
  edit(value);
  await writeFile(file, JSON.stringify(value));
}

beforeEach(async () => {
  await truncateAll(db);
  dir = await mkdtemp(join(tmpdir(), 'kno-content-'));
  await cp(REPO_CONTENT, dir, { recursive: true });
});
afterEach(() => rm(dir, { recursive: true, force: true }));
afterAll(() => database.close());

describe('kno import', () => {
  it('upserts published questions and the rotation, and a second run changes nothing', async () => {
    const first = await importContent(db, dir);
    expect(first.quizzes.written).toBe(3);
    expect(first.questions.written).toBe(42);
    expect(first.rotation.written).toBe(7);

    const before = await db.select().from(question).orderBy(asc(question.slug));
    const second = await importContent(db, dir);
    expect(countChanges(second)).toBe(0);
    const after = await db.select().from(question).orderBy(asc(question.slug));
    expect(after).toEqual(before);
    expect(after.every((row) => row.status === 'published')).toBe(true);

    const [lotr] = after.filter((row) => row.slug === 'lotr-oscars');
    expect(lotr).toMatchObject({ quizSlug: 'daily-originals', category: 'Movies', correctIndex: 1 });
    expect(lotr!.content.text.en).toMatch(/Academy Awards/);
    expect((await db.select().from(rotation)).map((row) => row.anchor)).toEqual(Array(7).fill('1970-01-01'));
  });

  it('updates a changed question by slug and touches only that row', async () => {
    await importContent(db, dir);
    await editJson('quizzes/daily-originals.json', (file) => {
      file.questions[0].summary.en = 'Edited summary.';
    });
    const report = await importContent(db, dir);
    expect(report.questions.written).toBe(1);
    expect(countChanges(report)).toBe(1);
    const [row] = await db.select().from(question).where(eq(question.slug, 'earth-atmosphere'));
    expect(row!.content.summary.en).toBe('Edited summary.');
  });

  it('marks a question that goes back to pending as unpublished instead of deleting it', async () => {
    await importContent(db, dir);
    await editJson('quizzes/daily-originals.json', (file) => {
      file.questions.find((item: { slug: string }) => item.slug === 'http-meaning').status = 'pending';
    });
    await editJson('daily/schedule.json', (file) => {
      file.rotation.questions = file.rotation.questions.filter((slug: string) => slug !== 'http-meaning');
    });

    const report = await importContent(db, dir);
    expect(report.questions.unpublished).toBe(1);
    expect(report.rotation.removed).toBe(1);
    expect(report.skippedPending).toBe(1);
    expect(report.pending).toEqual(['question http-meaning (daily-originals)']);
    const [row] = await db.select().from(question).where(eq(question.slug, 'http-meaning'));
    expect(row?.status).toBe('unpublished');
    expect(await db.select().from(rotation)).toHaveLength(6);
  });

  it('never imports pending questions or pending schedule entries', async () => {
    await editJson('quizzes/daily-originals.json', (file) => {
      file.questions.push({ ...file.questions[0], slug: 'draft-question', status: 'pending' });
    });
    await editJson('daily/schedule.json', (file) => {
      file.entries = [
        { dailyDate: '2026-12-01', question: 'largest-desert', status: 'published' },
        { dailyDate: '2026-12-02', question: 'largest-desert', status: 'pending' },
      ];
    });
    const report = await importContent(db, dir);
    expect(report.skippedPending).toBe(2);
    expect(report.pending).toEqual(['question draft-question (daily-originals)', 'daily 2026-12-02 (largest-desert)']);
    expect(await db.select().from(question).where(eq(question.slug, 'draft-question'))).toHaveLength(0);
    expect(await db.select().from(scheduleEntry)).toEqual([expect.objectContaining({ dailyDate: '2026-12-01', questionSlug: 'largest-desert' })]);
  });

  it('syncs schedule entries exactly: removed or pending entries are deleted', async () => {
    await editJson('daily/schedule.json', (file) => {
      file.entries = [
        { dailyDate: '2026-12-01', question: 'largest-desert', status: 'published' },
        { dailyDate: '2026-12-02', question: 'http-meaning', status: 'published' },
        { dailyDate: '2026-12-03', question: 'lotr-oscars', status: 'published' },
      ];
    });
    await importContent(db, dir);
    await editJson('daily/schedule.json', (file) => {
      file.entries = [
        { dailyDate: '2026-12-01', question: 'largest-desert', status: 'published' },
        { dailyDate: '2026-12-03', question: 'lotr-oscars', status: 'pending' },
      ];
    });
    const report = await importContent(db, dir);
    expect(report.entries.removed).toBe(2);
    expect(countChanges(report)).toBe(2);
    expect((await db.select().from(scheduleEntry)).map((row) => row.dailyDate)).toEqual(['2026-12-01']);
  });

  it('rejects duplicate schedule dates and writes nothing', async () => {
    await editJson('daily/schedule.json', (file) => {
      file.entries = [
        { dailyDate: '2026-12-01', question: 'largest-desert', status: 'published' },
        { dailyDate: '2026-12-01', question: 'http-meaning', status: 'pending' },
      ];
    });
    await expect(importContent(db, dir)).rejects.toThrow(/duplicate entry for 2026-12-01/);
    expect(await db.select().from(question)).toHaveLength(0);
  });

  it('refuses a schedule naming an unpublished question and writes nothing', async () => {
    await editJson('daily/schedule.json', (file) => {
      file.rotation.questions.push('no-such-question');
    });
    await expect(importContent(db, dir)).rejects.toThrow(/no-such-question/);
    expect(await db.select().from(quiz)).toHaveLength(0);
    expect(await db.select().from(question)).toHaveLength(0);
  });

  it('reports invalid content files with the failing path', async () => {
    await editJson('quizzes/daily-originals.json', (file) => {
      file.questions[2].options.pop();
    });
    await expect(importContent(db, dir)).rejects.toThrow(/daily-originals\.json[\s\S]*questions\.2\.options/);
  });
  it('stores quiz metadata and each Question\'s Difficulty (Story 2.1)', async () => {
    await importContent(db, dir);
    const [lotr] = await db.select().from(quiz).where(eq(quiz.slug, 'lord-of-the-rings'));
    expect(lotr).toMatchObject({ kind: 'quiz', category: 'Movies', theme: 'emerald', status: 'published', expertShare: 0.3 });
    expect(lotr!.description?.en).toBeTruthy();
    const [pool] = await db.select().from(quiz).where(eq(quiz.slug, 'daily-originals'));
    expect(pool).toMatchObject({ kind: 'dailyPool', category: null });

    const rows = await db.select().from(question).where(eq(question.quizSlug, 'lord-of-the-rings'));
    expect(rows).toHaveLength(20);
    expect(rows.filter((row) => row.difficulty === 'expert')).toHaveLength(6);
    // Category and theme come from the quiz when a Question sets none.
    expect(rows.every((row) => row.category === 'Movies' && row.theme === 'emerald')).toBe(true);
    expect(rows.every((row) => row.content.source.url.startsWith('https://'))).toBe(true);
    expect(rows.every((row) => row.content.video === undefined)).toBe(true);
  });

  it('skips a pending quiz with all its Questions and lists it', async () => {
    await editJson('quizzes/solar-system.json', (file) => {
      file.status = 'pending';
    });
    const report = await importContent(db, dir);
    expect(report.pending).toEqual(['quiz solar-system (with its 15 questions)']);
    expect(await db.select().from(quiz).where(eq(quiz.slug, 'solar-system'))).toHaveLength(0);
  });

  it('marks a published Question removed from its file as unpublished, never deleting it (AD-9)', async () => {
    await importContent(db, dir);
    await editJson('quizzes/lord-of-the-rings.json', (file) => {
      file.questions = file.questions.filter((item: { slug: string }) => item.slug !== 'lotr-balrog');
    });
    const report = await importContent(db, dir);
    expect(report.questions.unpublished).toBe(1);
    const [row] = await db.select().from(question).where(eq(question.slug, 'lotr-balrog'));
    expect(row?.status).toBe('unpublished');

    // Putting it back publishes it again.
    await cp(join(REPO_CONTENT, 'quizzes/lord-of-the-rings.json'), join(dir, 'quizzes/lord-of-the-rings.json'));
    await importContent(db, dir);
    const [again] = await db.select().from(question).where(eq(question.slug, 'lotr-balrog'));
    expect(again?.status).toBe('published');
  });

  it('names the file, field and Question when a Source is missing', async () => {
    await editJson('quizzes/lord-of-the-rings.json', (file) => {
      delete file.questions[3].source;
    });
    await expect(importContent(db, dir)).rejects.toThrow(/lord-of-the-rings\.json[\s\S]*questions\.3\.source \(question "lotr-gandalf-actor"\)/);
    expect(await db.select().from(question)).toHaveLength(0);
  });

  it('rejects a Question with more than four Options, or without a Difficulty', async () => {
    await editJson('quizzes/solar-system.json', (file) => {
      file.questions[0].options.push({ en: 'Pluto' });
      delete file.questions[1].difficulty;
    });
    const error = await importContent(db, dir).catch((caught: Error) => caught);
    expect(String(error)).toMatch(/solar-system\.json/);
    expect(String(error)).toMatch(/questions\.0\.options \(question "solar-largest-planet"\)/);
    expect(String(error)).toMatch(/questions\.1\.difficulty/);
  });

  it('requires a Category, theme and description for a listed quiz', async () => {
    await editJson('quizzes/solar-system.json', (file) => {
      delete file.category;
    });
    await expect(importContent(db, dir)).rejects.toThrow(/solar-system\.json[\s\S]*category: required for a listed quiz/);
  });

  it('requires the quiz slug to match its file name', async () => {
    await editJson('quizzes/solar-system.json', (file) => {
      file.slug = 'planets';
    });
    await expect(importContent(db, dir)).rejects.toThrow(/solar-system\.json[\s\S]*slug: must match the file name/);
  });
  it('imports Badges and Titles with their Unlock Rules (Story 3.1)', async () => {
    const report = await importContent(db, dir);
    expect(report.awards.written).toBe(5);
    const rows = await db.select().from(award).where(eq(award.quizSlug, 'lord-of-the-rings'));
    expect(rows.map((row) => [row.kind, row.slug, row.unlock])).toEqual(
      expect.arrayContaining([
        ['badge', 'lotr-middle-earth-fan', { type: 'correctShare', min: 0.8 }],
        ['title', 'lotr-gandalf', { type: 'allCorrect', difficulty: 'expert' }],
        ['title', 'lotr-frodo', { type: 'correctShare', min: 0.5 }],
      ]),
    );
    expect(countChanges(await importContent(db, dir))).toBe(0);
  });

  it('fails the import on an unknown Unlock Rule type, naming the file and item', async () => {
    await editJson('quizzes/lord-of-the-rings.json', (file) => {
      file.titles[0].unlock = { type: 'speedRun', seconds: 30 };
    });
    await expect(importContent(db, dir)).rejects.toThrow(/lord-of-the-rings\.json[\s\S]*titles\.0\.unlock\.type \(title "lotr-gandalf"\): Invalid discriminator value/);
    expect(await db.select().from(award)).toHaveLength(0);
  });

  it('rejects malformed rules of a known type', async () => {
    await editJson('quizzes/solar-system.json', (file) => {
      file.badges[0].unlock = { type: 'correctShare', min: 80 };
    });
    await expect(importContent(db, dir)).rejects.toThrow(/badges\.0\.unlock\.min \(badge "solar-stargazer"\)/);
  });

  it('skips pending Badges and marks removed ones unpublished, never deleting them', async () => {
    await importContent(db, dir);
    await editJson('quizzes/lord-of-the-rings.json', (file) => {
      file.badges[0].status = 'pending';
      file.titles = file.titles.filter((item: { slug: string }) => item.slug !== 'lotr-frodo');
    });
    const report = await importContent(db, dir);
    expect(report.awards.unpublished).toBe(2);
    expect(report.pending).toEqual(['badge lotr-middle-earth-fan (lord-of-the-rings)']);
    const rows = await db.select().from(award).where(eq(award.status, 'unpublished'));
    expect(rows.map((row) => row.slug).sort()).toEqual(['lotr-frodo', 'lotr-middle-earth-fan']);
  });

  it('refuses duplicate Badge or Title slugs across files', async () => {
    await editJson('quizzes/solar-system.json', (file) => {
      file.titles[0].slug = 'lotr-gandalf';
    });
    await expect(importContent(db, dir)).rejects.toThrow(/Duplicate badge\/title slug "lotr-gandalf"/);
  });
});
